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
    sha256, instantaneoACada: extra.instantaneoACada });
  return ap;
}
const CPFS = ["529.982.247-25", "111.444.777-35", "390.533.447-05"];

test("o ponto estável é a menor promessa entre os aparelhos conhecidos", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await dispositivo("A", base, nuvem, { relogio: { ms: 5_000_000 } });
  const b = await dispositivo("B", base, nuvem, { relogio: { ms: 1_000_000 } });
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", CPFS[0]));
  await a.sync.sincronizar();
  await b.sync.sincronizar();                       // B conhece a op de A; promessa de B > op de A
  const p = await a.sync.pontoEstavel();
  const pa = (await a.sync.lerAparelhos()).find((x) => x.aparelho === "A").promessa;
  const pb = (await a.sync.lerAparelhos()).find((x) => x.aparelho === "B").promessa;
  const menor = pa.t < pb.t || (pa.t === pb.t && pa.c <= pb.c) ? pa : pb;
  assert.equal(JSON.stringify(p), JSON.stringify(menor));
});

test("aparelho novo entra pelo instantâneo e passa a ter os mesmos dados", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await dispositivo("A", base, nuvem, { relogio: { ms: 1_000_000 } });
  const b = await dispositivo("B", base, nuvem, { relogio: { ms: 1_000_500 } });
  for (let i = 0; i < 3; i += 1) {
    await a.chamar("sec@c.com", "POST", "/api/agendamentos",
      agendamento(`at-${i}`, `2026-10-12T${String(8 + i).padStart(2, "0")}:00`, CPFS[i], `Tutor ${i}`));
  }
  await a.sync.sincronizar();
  await b.sync.sincronizar();
  await a.sync.sincronizar();                       // A já enxerga a promessa de B
  const inst = await a.sync.publicarInstantaneo(1);
  assert.ok(inst, "instantâneo publicado");
  assert.equal(inst.operacoes, 3);
  assert.ok(nuvem.caminhos().some((c) => c.startsWith("instantaneos/")));

  // A continua trabalhando depois do instantâneo
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-9", "2026-10-13T09:00", CPFS[0], "T9"));
  await a.sync.sincronizar();

  const c = await dispositivo("C", base, nuvem, { relogio: { ms: 100 } });   // relógio muito atrasado
  const r = await c.sync.entrar();
  assert.ok(r.instantaneo);
  assert.equal(c.motor.corte() !== null, true);
  await a.sync.sincronizar();
  await b.sync.sincronizar();
  await c.sync.sincronizar();
  assert.equal(c.estado(), a.estado());
  assert.equal(c.estado(), b.estado());
  assert.equal(c.repo.ler("Atendimento").length, 4);

  // C passa a operar: a marca dele fica acima de tudo o que viu, mesmo com o relógio atrasado
  await c.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-c", "2026-10-13T10:00", CPFS[1], "TC"));
  await c.sync.sincronizar();
  await a.sync.sincronizar();
  await b.sync.sincronizar();
  assert.equal(a.estado(), c.estado());
  assert.equal(b.estado(), c.estado());
  assert.equal(a.repo.ler("Atendimento").length, 5);
});

test("sem aparelho que ainda não prometeu nada, não há instantâneo", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await dispositivo("A", base, nuvem);
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", CPFS[0]));
  await a.sync.sincronizar();
  // aparelho B registrado, mas sem promessa (arquivo antigo/parcial)
  await nuvem.cliente("B").gravar("aparelhos/B.json", JSON.stringify({ formato: "ronivet-aparelho-1", aparelho: "B" }));
  assert.equal(await a.sync.pontoEstavel(), null);
  assert.equal(await a.sync.publicarInstantaneo(1), null);
});

test("instantâneo corrompido é ignorado: o aparelho novo parte do estado vazio e lê tudo", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await dispositivo("A", base, nuvem);
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", CPFS[0]));
  await a.sync.sincronizar();
  await a.sync.sincronizar();
  assert.ok(await a.sync.publicarInstantaneo(1));
  const caminho = nuvem.caminhos().find((c) => c.startsWith("instantaneos/"));
  nuvem.arquivos.get(caminho).conteudo = nuvem.arquivos.get(caminho).conteudo.slice(0, 100);
  const c = await dispositivo("C", base, nuvem);
  const r = await c.sync.entrar();
  assert.equal(r.instantaneo, null);
  assert.equal(c.repo.ler("Atendimento").length, 1, "leu as operações do zero");
  assert.equal(c.estado(), a.estado());
});

test("ciclo publica o instantâneo sozinho quando há operações suficientes", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await dispositivo("A", base, nuvem, { instantaneoACada: 2, relogio: { ms: 1_000_000 } });
  for (let i = 0; i < 3; i += 1) {
    await a.chamar("sec@c.com", "POST", "/api/agendamentos",
      agendamento(`at-${i}`, `2026-10-12T${String(8 + i).padStart(2, "0")}:00`, CPFS[i], `T${i}`));
  }
  const r = await a.sync.sincronizar();
  assert.ok(r.instantaneo, "só um aparelho conhecido: o ponto estável é o próprio");
  assert.equal(r.instantaneo.operacoes, 3);
});
