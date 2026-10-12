"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { criarBase, criarAparelho, agendamento } = require("./aparelho_util");

async function preparar() {
  const base = await criarBase();
  const ap = await criarAparelho({ nome: "A", base, relogio: { ms: 1_000_000 } });
  await ap.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", "529.982.247-25"));
  await ap.chamar("admin@c.com", "PUT", "/api/atendimentos/at-1/valores", { versao: 1,
    valores: { produto: "V10", lote: "L1", data_aplicacao: "2026-10-12" } });
  return ap;
}

test("administrador sem CRMV não encerra nem faz aditamento", async () => {
  const ap = await preparar();
  const e = await ap.chamar("admin@c.com", "POST", "/api/atendimentos/at-1/encerrar", {});
  assert.equal(e.status, 403);
  assert.equal(JSON.stringify(e.corpo).includes("crmv_necessario"), true);
  assert.equal(ap.repo.ler("Atendimento")[0].status, "AGENDADO");
});

test("administrador com CRMV cadastrado encerra e registra aditamento", async () => {
  const ap = await preparar();
  const u = await ap.chamar("admin@c.com", "PATCH", "/api/usuarios/admin@c.com", { crmv: "CRMV-SP 999" });
  assert.equal(u.status, 200, JSON.stringify(u.corpo));
  const e = await ap.chamar("admin@c.com", "POST", "/api/atendimentos/at-1/encerrar", {});
  assert.equal(e.status, 200, JSON.stringify(e.corpo));
  const a = await ap.chamar("admin@c.com", "POST", "/api/atendimentos/at-1/aditamentos", { texto: "ok" });
  assert.equal(a.status, 201);
  const s = await ap.chamar("sec@c.com", "POST", "/api/atendimentos/at-1/aditamentos", { texto: "x" });
  assert.equal(s.status, 403);
});
