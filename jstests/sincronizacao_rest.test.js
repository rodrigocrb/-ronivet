"use strict";
// A sincronização completa (lotes, instantâneos, documentos) sobre o cliente REST do Drive,
// contra o servidor falso da API: o mesmo comportamento do Drive em memória.
const test = require("node:test");
const assert = require("node:assert/strict");
const { criarClienteDrive } = require("../web/drive-rest");
const { abrirRaiz } = require("../web/raiz");
const { criarSincronizador } = require("../web/sincronizacao");
const A = require("../web/ambiente-local");
const { criarDriveFalso } = require("./drive_falso");
const { criarBase, criarAparelho, agendamento } = require("./aparelho_util");

const CPFS = ["529.982.247-25", "111.444.777-35", "390.533.447-05"];

async function dispositivo(nome, base, falso, extra = {}) {
  const ap = await criarAparelho({ nome, base, ...extra });
  const drive = criarClienteDrive({ fetchImpl: falso.fetchImpl, abrirRaiz,
    obterToken: async () => falso.estado.tokenValido });
  ap.drive = drive;
  ap.sync = criarSincronizador({ motor: ap.motor, repo: ap.repo, drive, aparelho: nome,
    sha256: A.sha256, paraBase64: A.paraBase64, deBase64: A.deBase64,
    instantaneoACada: extra.instantaneoACada });
  return ap;
}

test("dois aparelhos convergem pelo Drive REST, com conflito de horário e encerramento", async () => {
  const base = await criarBase();
  const f = criarDriveFalso();
  const a = await dispositivo("A", base, f, { relogio: { ms: 1_000_000 } });
  const b = await dispositivo("B", base, f, { relogio: { ms: 2_000_000 } });
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-a", "2026-10-12T09:00", CPFS[0], "Ana"));
  await b.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-b", "2026-10-12T09:00", CPFS[1], "Beto"));
  await a.chamar("vet@c.com", "PUT", "/api/atendimentos/at-a/valores",
    { valores: { produto: "V10", lote: "L1", data_aplicacao: "2026-10-12" }, versao: 1 });
  await a.chamar("vet@c.com", "POST", "/api/atendimentos/at-a/encerrar", {});

  for (let i = 0; i < 2; i += 1) {
    const ra = await a.sync.sincronizar();
    const rb = await b.sync.sincronizar();
    assert.equal(ra.erros.length, 0, JSON.stringify(ra));
    assert.equal(rb.erros.length, 0, JSON.stringify(rb));
  }
  // o documento é gerado depois, quando há conexão, e anexado pela operação do núcleo
  const gerou = await a.fluxoCom(a.drive).gerarPendentes();
  assert.equal(gerou.gerados, 1, JSON.stringify(gerou));
  await a.sync.sincronizar();
  await b.sync.sincronizar();
  assert.equal(a.estado(), b.estado());
  assert.equal(a.motor.recusadas().length, 1);
  assert.equal(a.motor.recusadas()[0].aparelho, "B");
  const at = b.repo.ler("Atendimento").find((x) => x.id_atendimento === "at-a");
  assert.equal(at.status, "ENCERRADO");
  assert.equal(at.documento_estado, "GERADO");

  // estrutura no Drive: uma raiz com as pastas esperadas e o PDF por hash
  assert.equal(f.pastas().filter((p) => p.name === "RoniVet").length, 1);
  const nomes = f.nomes();
  assert.ok(nomes.includes("A.json") && nomes.includes("B.json"));
  assert.ok(nomes.includes(at.documento_nome.split("/").pop()), "PDF com nome legível no Drive");
  const lido = await b.drive.lerBytes(`documentos/${at.documento_nome}`);
  assert.equal(A.sha256(lido), at.hash_sha256);
  assert.equal(b.repo.listarArquivos().filter((c) => c.endsWith(".pdf")).length, 0, "sem PDF no aparelho");
  assert.ok(nomes.some((n) => /^lote-\d{6}\.json$/.test(n)));
});

test("aparelho novo entra pelo instantâneo publicado no Drive REST", async () => {
  const base = await criarBase();
  const f = criarDriveFalso();
  const a = await dispositivo("A", base, f, { relogio: { ms: 1_000_000 } });
  const b = await dispositivo("B", base, f, { relogio: { ms: 1_000_500 } });
  for (let i = 0; i < 3; i += 1) {
    await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento(
      `at-${i}`, `2026-10-12T${String(8 + i).padStart(2, "0")}:00`, CPFS[i], `T${i}`));
  }
  await a.sync.sincronizar();
  await b.sync.sincronizar();
  await a.sync.sincronizar();
  const inst = await a.sync.publicarInstantaneo(1);
  assert.ok(inst);
  assert.ok(f.nomes().some((n) => n.startsWith("inst-")));

  const c = await dispositivo("C", base, f, { relogio: { ms: 100 } });
  const r = await c.sync.entrar();
  assert.ok(r.instantaneo);
  await a.sync.sincronizar();
  await b.sync.sincronizar();
  await c.sync.sincronizar();
  assert.equal(c.estado(), a.estado());
  assert.equal(c.repo.ler("Atendimento").length, 3);
});

test("falhas de rede e de cota no Drive deixam as operações pendentes e se recuperam", async () => {
  const base = await criarBase();
  const f = criarDriveFalso();
  const a = await dispositivo("A", base, f);
  const b = await dispositivo("B", base, f);
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", CPFS[0]));
  f.estado.falhas.push("rede", { status: 403, reason: "userRateLimitExceeded" }, { status: 503 });
  const r1 = await a.sync.sincronizar();
  assert.ok(r1.erros.length >= 1);
  assert.equal(a.motor.pendentesDeEnvio().length, 1);
  const r2 = await a.sync.sincronizar();
  assert.ok(r2.erros.every((e) => ["cota", "indisponivel"].includes(e.codigo)) || r2.erros.length === 0);
  for (let i = 0; i < 3; i += 1) { await a.sync.sincronizar(); await b.sync.sincronizar(); }
  assert.equal(a.motor.pendentesDeEnvio().length, 0);
  assert.equal(b.repo.ler("Atendimento").length, 1);
});

test("autorização expirada: erro com código \"autorizacao\" e nada é perdido", async () => {
  const base = await criarBase();
  const f = criarDriveFalso();
  const a = await dispositivo("A", base, f);
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", CPFS[0]));
  f.estado.tokenValido = "outro-token";           // o aparelho segue com um token que o Google recusa
  const ruim = criarClienteDrive({ fetchImpl: f.fetchImpl, abrirRaiz, obterToken: async () => "velho" });
  const sync = criarSincronizador({ motor: a.motor, repo: a.repo, drive: ruim, aparelho: "A",
    sha256: A.sha256, paraBase64: A.paraBase64, deBase64: A.deBase64 });
  const r = await sync.sincronizar();
  assert.ok(r.erros.some((e) => e.codigo === "autorizacao"));
  assert.equal(a.motor.pendentesDeEnvio().length, 1, "continua pendente");
  assert.equal(a.repo.ler("Atendimento").length, 1, "uso local intacto");
});
