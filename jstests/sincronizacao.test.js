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
  ap.sync = criarSincronizador({ motor: ap.motor, repo: ap.repo, drive: ap.drive, aparelho: nome,
    sha256, tamanhoLote: extra.tamanhoLote });
  return ap;
}

const lotesDe = (nuvem) => nuvem.caminhos().filter((c) => c.startsWith("operacoes/"));
const CPFS = ["529.982.247-25", "111.444.777-35", "390.533.447-05"];

test("operação feita offline é publicada na próxima sincronização, sem perda nem duplicação", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await dispositivo("A", base, nuvem);
  const b = await dispositivo("B", base, nuvem);
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", CPFS[0]));
  nuvem.falhar = 1;                                  // sem conexão
  const r0 = await a.sync.sincronizar();
  assert.ok(r0.erros.length >= 1);
  assert.equal(a.motor.pendentesDeEnvio().length, 1, "continua pendente");
  assert.deepEqual(lotesDe(nuvem), []);

  const r1 = await a.sync.sincronizar();
  assert.equal(r1.publicadas, 1);
  assert.equal(a.motor.pendentesDeEnvio().length, 0);
  assert.deepEqual(lotesDe(nuvem), ["operacoes/A/lote-000001.json"]);
  await a.sync.sincronizar();                         // nada novo: não republica
  assert.equal(lotesDe(nuvem).length, 1);

  const rb = await b.sync.sincronizar();
  assert.equal(rb.recebidas, 1);
  assert.equal(b.repo.ler("Atendimento").length, 1);
  assert.equal(a.estado(), b.estado());
});

test("releitura do mesmo lote não repete efeitos", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await dispositivo("A", base, nuvem);
  const b = await dispositivo("B", base, nuvem);
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", CPFS[0]));
  await a.sync.sincronizar();
  await b.sync.sincronizar();
  const antes = b.estado();
  // outro ciclo do mesmo aparelho já não relê; e um sincronizador novo (reabertura) tampouco
  await b.sync.sincronizar();
  const b2 = await dispositivo("B", base, nuvem, { armazenamento: b.armazenamento });
  const r = await b2.sync.sincronizar();
  assert.equal(r.lotesLidos, 0);
  assert.equal(b2.estado(), antes);
});

test("lote corrompido ou truncado não é aplicado e é relido depois", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await dispositivo("A", base, nuvem);
  const b = await dispositivo("B", base, nuvem);
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", CPFS[0]));
  // grava o lote bom e depois o substitui por uma versão truncada, como um upload interrompido
  await a.sync.sincronizar();
  const caminho = "operacoes/A/lote-000001.json";
  const bom = nuvem.arquivos.get(caminho).conteudo;
  nuvem.arquivos.get(caminho).conteudo = bom.slice(0, bom.length - 40);
  const r1 = await b.sync.sincronizar();
  assert.equal(r1.recebidas, 0);
  assert.equal(r1.erros.length, 1);
  assert.match(r1.erros[0].motivo, /ilegível|hash/);
  assert.equal(b.repo.ler("Atendimento").length, 0, "nada aplicado pela metade");
  nuvem.arquivos.get(caminho).conteudo = bom;         // upload refeito
  const r2 = await b.sync.sincronizar();
  assert.equal(r2.recebidas, 1);
  assert.equal(b.repo.ler("Atendimento").length, 1);
});

test("upload truncado é detectado pelo próprio aparelho e regravado", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await dispositivo("A", base, nuvem);
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", CPFS[0]));
  nuvem.truncarProximaGravacao = 30;
  const r = await a.sync.sincronizar();
  assert.equal(r.erros.length, 0);
  assert.equal(r.publicadas, 1);
  const lido = JSON.parse(nuvem.arquivos.get("operacoes/A/lote-000001.json").conteudo);
  assert.equal(lido.operacoes.length, 1);
});

test("falha depois de enviar o lote: a repetição reaproveita o mesmo lote, sem duplicar", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const real = nuvem.cliente("A");
  let quebrar = true;
  const drive = { ...real, async gravar(c, t, o) {
    const r = await real.gravar(c, t, o);
    if (quebrar) { quebrar = false; throw new Error("conexão caiu depois do envio"); }
    return r;
  } };
  const a = await criarAparelho({ nome: "A", base });
  a.sync = criarSincronizador({ motor: a.motor, repo: a.repo, drive, aparelho: "A", sha256 });
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", CPFS[0]));
  const r1 = await a.sync.sincronizar();
  assert.equal(r1.erros.length, 1);
  assert.equal(a.motor.pendentesDeEnvio().length, 1, "ainda não marcada como publicada");
  assert.equal(lotesDe(nuvem).length, 1, "o lote já está no Drive");
  const r2 = await a.sync.sincronizar();
  assert.equal(r2.erros.length, 0);
  assert.equal(r2.publicadas, 1);
  assert.equal(lotesDe(nuvem).length, 1, "sem lote duplicado");
  assert.equal(a.motor.pendentesDeEnvio().length, 0);
});

test("muitos lotes: tamanho do lote respeitado e leitura em ordem", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await dispositivo("A", base, nuvem, { tamanhoLote: 2 });
  const b = await dispositivo("B", base, nuvem);
  for (let i = 0; i < 5; i += 1) {
    await a.chamar("sec@c.com", "POST", "/api/agendamentos",
      agendamento(`at-${i}`, `2026-10-12T${String(8 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`, CPFS[i % 3], `T${i}`));
  }
  const r = await a.sync.sincronizar();
  assert.equal(r.publicadas, 5);
  assert.equal(lotesDe(nuvem).length, 3);           // 2 + 2 + 1
  const rb = await b.sync.sincronizar();
  assert.equal(rb.lotesLidos, 3);
  assert.equal(a.estado(), b.estado());
});
