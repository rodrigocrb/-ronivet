"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { criarNuvem } = require("./drive_memoria");
const { criarSincronizador } = require("../web/sincronizacao");
const { sha256 } = require("../web/ambiente-local");
const { criarBase, criarAparelho, agendamento } = require("./aparelho_util");

async function dispositivo(nome, base, nuvem, extra = {}) {
  const ap = await criarAparelho({ nome, base, ...extra });
  ap.drive = nuvem.cliente(nome);
  ap.retirado = null;
  ap.sync = criarSincronizador({ motor: ap.motor, repo: ap.repo, drive: ap.drive, aparelho: nome,
    sha256, instantaneoACada: extra.instantaneoACada,
    aoSerRetirado: async (r) => { ap.retirado = r; await ap.repo.apagarTudo(); } });
  return ap;
}
const CPFS = ["529.982.247-25", "111.444.777-35", "390.533.447-05"];

test("aparelho retirado deixa de travar o ponto estável e de enviar operações", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await dispositivo("A", base, nuvem, { relogio: { ms: 5_000_000 } });
  const b = await dispositivo("B", base, nuvem, { relogio: { ms: 5_000_500 } });
  const morto = await dispositivo("M", base, nuvem, { relogio: { ms: 1_000 } });
  await morto.sync.sincronizar();                    // registra-se e some (relógio atrasado)
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", CPFS[0]));
  await a.sync.sincronizar();
  await b.sync.sincronizar();
  await a.sync.sincronizar();
  assert.equal(await a.sync.publicarInstantaneo(1), null, "o aparelho parado trava o ponto estável");

  const r = await a.sync.retirar("M", { por: "admin@c.com", motivo: "perdido", em: "2026-10-12T10:00" });
  assert.equal(r.ultimoLote, 0);
  assert.ok(nuvem.caminhos().includes("retirados/M.json"));
  const inst = await a.sync.publicarInstantaneo(1);
  assert.ok(inst, "sem o aparelho retirado o instantâneo é publicado");
  assert.equal(inst.operacoes, 1);
});

test("o aparelho retirado apaga o banco local e não envia nada ao sincronizar", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await dispositivo("A", base, nuvem, { relogio: { ms: 1_000_000 } });
  const c = await dispositivo("C", base, nuvem, { relogio: { ms: 1_000_100 } });
  await c.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-c", "2026-10-12T09:00", CPFS[0]));
  await c.sync.sincronizar();
  await a.sync.retirar("C", { por: "admin@c.com", motivo: "celular perdido" });

  // C faz mais uma operação offline e só então volta à rede
  await c.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-c2", "2026-10-12T10:00", CPFS[1]));
  const lotesAntes = nuvem.caminhos().filter((x) => x.startsWith("operacoes/C/")).length;
  const resultado = await c.sync.sincronizar();
  assert.ok(resultado.retirado);
  assert.equal(resultado.retirado.motivo, "celular perdido");
  assert.equal(c.retirado.aparelho, "C");
  assert.equal(nuvem.caminhos().filter((x) => x.startsWith("operacoes/C/")).length, lotesAntes);
  assert.equal(c.repo.ler("Usuario").length, 0, "banco local apagado");
  assert.equal(c.repo.listarArquivos().length, 0);
  // o que C já tinha publicado antes da retirada continua valendo para os outros
  await a.sync.sincronizar();
  assert.equal(a.repo.ler("Atendimento").some((x) => x.id_atendimento === "at-c"), true);
  assert.equal(a.repo.ler("Atendimento").some((x) => x.id_atendimento === "at-c2"), false);
});

test("lotes publicados depois do último lote registrado na retirada são ignorados por todos", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await dispositivo("A", base, nuvem, { relogio: { ms: 1_000_000 } });
  const b = await dispositivo("B", base, nuvem, { relogio: { ms: 1_000_100 } });
  await b.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", CPFS[0]));
  await b.sync.sincronizar();                        // lote 1
  await a.sync.retirar("B", { por: "admin@c.com" });
  // B ainda não soube e publica outro lote (corrida)
  await b.drive.gravar("operacoes/B/lote-000002.json", JSON.stringify({ formato: "ronivet-lote-1",
    aparelho: "B", seq: 2, operacoes: [], sha256: sha256("[]") }));
  const r = await a.sync.sincronizar();
  assert.equal(r.lotesLidos, 1, "só o lote 1 de B vale");
  assert.deepEqual(r.erros, []);
});

test("retirar o próprio aparelho é recusado e a retirada repetida mantém a primeira", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await dispositivo("A", base, nuvem);
  await assert.rejects(() => a.sync.retirar("A", {}), /próprio aparelho/);
  const um = await a.sync.retirar("X", { motivo: "primeira" });
  const dois = await a.sync.retirar("X", { motivo: "segunda" });
  assert.equal(um.motivo, "primeira");
  assert.equal(dois.motivo, "primeira");
});
