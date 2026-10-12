"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const A = require("../web/ambiente-local");
const L = require("../web/repositorio-local");

function nucleo() {
  const ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "web", "nucleo.js"), "utf8"), ctx);
  return ctx.RoniVet;
}

test("sha256 e base64 coincidem com o Node (vetores e aleatórios)", () => {
  const entradas = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "ação ✓ 日本"];
  for (let i = 0; i < 40; i += 1) entradas.push(crypto.randomBytes(i * 7));
  for (const e of entradas) {
    const buf = typeof e === "string" ? Buffer.from(e, "utf8") : e;
    assert.equal(A.sha256(e), crypto.createHash("sha256").update(buf).digest("hex"));
    assert.equal(A.paraBase64(e), buf.toString("base64"));
    assert.equal(Buffer.from(A.deBase64(buf.toString("base64"))).toString("hex"), buf.toString("hex"));
  }
});

test("o ambiente recusa uso fora de uma operação e aninhamento", () => {
  const amb = A.criarAmbienteLocal();
  assert.throws(() => amb.agora(), /fora de uma operação/);
  assert.throws(() => amb.executarComo({ idOp: "x", hora: "h" },
    () => amb.executarComo({ idOp: "y", hora: "h" }, () => 0)), /aninhadas/);
});

test("a mesma operação em dois aparelhos gera dados e ids idênticos", async () => {
  const R = nucleo();
  const ISO = "2026-01-01T00:00:00-03:00";
  async function aparelho() {
    const repo = await L.criarRepositorioLocal({ R, armazenamento: L.armazenamentoMemoria() });
    repo.aplicar([
      ["Usuario", { email: "admin@c.com", nome: "Admin", perfil: "ADMIN" }],
      ["TipoAtendimento", { id_tipo: "tipo-vacina", nome: "Vacina", duracao_min: 30,
        criado_em: ISO, atualizado_em: ISO }],
    ].map(([tabela, linha]) => ({ tabela, tipo: "inserir", linha: R.completarLinha(tabela, linha) })));
    const amb = A.criarAmbienteLocal();
    const api = R.criarApi({ repo, amb, config: { permitirLoginTeste: true, googleClientId: "" } });
    return { repo, amb, api };
  }
  const a = await aparelho();
  const b = await aparelho();
  const chamar = (x, idOp, hora, req) => x.amb.executarComo({ idOp, hora }, () => x.api.tratar({
    credencial: "fake:admin@c.com", idOp, ...req }));
  const req = { metodo: "POST", caminho: "/api/tutores",
    corpo: { nome: "Ana", telefone: "11988887777", cpf: "529.982.247-25" } };
  const ra = chamar(a, "op-1", "2026-10-11T12:00:00-03:00", req);
  const rb = chamar(b, "op-1", "2026-10-11T12:00:00-03:00", req);
  assert.equal(ra.status, 201, JSON.stringify(ra));
  assert.equal(JSON.stringify(ra), JSON.stringify(rb));
  for (const t of ["Tutor", "Auditoria", "Operacao", "Meta"]) {
    assert.equal(JSON.stringify(a.repo.ler(t)), JSON.stringify(b.repo.ler(t)), t);
  }
  assert.match(a.repo.ler("Tutor")[0].id_tutor, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
});
