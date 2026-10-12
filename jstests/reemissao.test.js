"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { criarNuvem } = require("./drive_memoria");
const { criarBase, criarAparelho, agendamento } = require("./aparelho_util");

async function encerrado() {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const ap = await criarAparelho({ nome: "A", base, relogio: { ms: 1_000_000 } });
  const drive = nuvem.cliente("A");
  const fluxo = ap.fluxoCom(drive);
  const r1 = await ap.chamar("sec@c.com", "POST", "/api/agendamentos",
    agendamento("at-1", "2026-10-12T09:00", "529.982.247-25"));
  assert.equal(r1.status, 201);
  await ap.chamar("vet@c.com", "PUT", "/api/atendimentos/at-1/valores", { versao: 1,
    valores: { produto: "V10", lote: "L1", data_aplicacao: "2026-10-12" } });
  const enc = await ap.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/encerrar", {});
  assert.equal(enc.status, 200);
  const g = await fluxo.gerarPendentes();
  assert.equal(g.gerados, 1);
  return { ap, nuvem, drive, fluxo };
}
const doc = (ap) => ap.repo.ler("Atendimento").find((a) => a.id_atendimento === "at-1");

test("nova emissão: PDF some do Drive, é emitido de novo e o hash original fica na auditoria", async () => {
  const { ap, drive, fluxo } = await encerrado();
  const original = doc(ap);
  assert.equal(original.documento_estado, "GERADO");
  await drive.excluir(`documentos/${original.documento_nome}`);
  assert.equal((await fluxo.obterBytes("at-1")).estado, "ausente");

  const r = await ap.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/documento/reemitir", {});
  assert.equal(r.status, 200);
  assert.equal(r.corpo.reemitido, true);
  assert.equal(doc(ap).documento_estado, "PENDENTE");
  assert.equal((await fluxo.obterBytes("at-1")).estado, "pendente");

  const g = await fluxo.gerarPendentes();
  assert.equal(g.gerados, 1);
  const novo = doc(ap);
  assert.equal(novo.documento_estado, "GERADO");
  assert.notEqual(novo.documento_nome, original.documento_nome, "nome com a via");
  assert.match(novo.documento_nome, /2a via/);
  assert.equal(novo.documento_emissao, 2);
  assert.equal((await fluxo.obterBytes("at-1")).estado, "ok");

  const hist = ap.repo.ler("Auditoria").filter((a) => a.acao === "REEMITIR" && a.id_entidade === "at-1");
  assert.equal(hist.length, 1);
  assert.equal(hist[0].valor_anterior, original.hash_sha256);
});

test("pedir a nova emissão de novo enquanto pendente não conta outra via", async () => {
  const { ap, drive } = await encerrado();
  await drive.excluir(`documentos/${doc(ap).documento_nome}`);
  await ap.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/documento/reemitir", {});
  const r = await ap.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/documento/reemitir", {});
  assert.equal(r.corpo.reemitido, false);
  assert.equal(doc(ap).documento_emissao, 2);
});

test("secretária não emite nova via e atendimento não gerado é recusado", async () => {
  const { ap } = await encerrado();
  const s = await ap.chamar("sec@c.com", "POST", "/api/atendimentos/at-1/documento/reemitir", {});
  assert.equal(s.status, 403);
  await ap.chamar("sec@c.com", "POST", "/api/agendamentos",
    agendamento("at-2", "2026-10-12T10:00", "111.444.777-35", "Outro"));
  const r = await ap.chamar("vet@c.com", "POST", "/api/atendimentos/at-2/documento/reemitir", {});
  assert.equal(r.status, 409);
});
