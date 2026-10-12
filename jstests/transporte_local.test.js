"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { criarTransporte, agoraIso } = require("../web/transporte");
const L = require("../web/repositorio-local");
const A = require("../web/ambiente-local");

function nucleo() {
  const ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "web", "nucleo.js"), "utf8"), ctx);
  return ctx.RoniVet;
}

async function montar() {
  const R = nucleo();
  const armazenamento = L.armazenamentoMemoria();
  const repo = await L.criarRepositorioLocal({ R, armazenamento });
  repo.aplicar([{ tabela: "Usuario", tipo: "inserir",
    linha: R.completarLinha("Usuario", { email: "admin@c.com", nome: "Admin", perfil: "ADMIN" }) }]);
  await repo.descarregar();
  const amb = A.criarAmbienteLocal();
  const api = R.criarApi({ repo, amb, config: { permitirLoginTeste: true, googleClientId: "" } });
  let n = 0;
  const t = criarTransporte({ config: { modo: "local" }, obterCredencial: async () => "fake:admin@c.com",
    local: { api, amb, repo, novoIdOp: () => `op-${++n}`, agoraIso: () => "2026-10-11T12:00:00-03:00" } });
  return { R, repo, armazenamento, t };
}

const NOVO = JSON.stringify({ nome: "Ana", telefone: "11988887777", cpf: "529.982.247-25" });

test("modo local: a resposta só vem depois de gravada de forma durável", async () => {
  const { R, armazenamento, t } = await montar();
  const r = await t.rede("/api/tutores", { method: "POST", body: NOVO });
  assert.equal(r.status, 201);
  const reaberto = await L.criarRepositorioLocal({ R, armazenamento });
  assert.equal(reaberto.ler("Tutor").length, 1);
});

test("modo local: falha de gravação responde erro e mantém o pendente", async () => {
  const { armazenamento, repo, t } = await montar();
  armazenamento.falharProximaGravacao = true;
  const r = await t.rede("/api/tutores", { method: "POST", body: NOVO });
  assert.equal(r.status, 500);
  assert.equal((await r.json()).detail.codigo, "falha_gravacao_local");
  assert.equal(repo.pendenteDeGravacao(), true);
});

test("modo local: reenvio com o mesmo idOp não duplica", async () => {
  const { repo, t } = await montar();
  const a = await t.rede("/api/tutores", { method: "POST", body: NOVO, idOp: "mesma" });
  const b = await t.rede("/api/tutores", { method: "POST", body: NOVO, idOp: "mesma" });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(repo.ler("Tutor").length, 1);
});

test("agoraIso devolve ISO com deslocamento do fuso", () => {
  assert.match(agoraIso(new Date(2026, 9, 11, 9, 5, 7)), /^2026-10-11T09:05:07[+-]\d\d:\d\d$/);
});
