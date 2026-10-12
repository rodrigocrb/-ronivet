"use strict";
// O núcleo empacotado para o aparelho (web/nucleo.js) precisa estar em dia com src/ e
// funcionar sozinho, sem nenhum global do Google.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { montar, modulos } = require("../montar_nucleo");

const ARQUIVO = path.join(__dirname, "..", "..", "web", "nucleo.js");

function carregarNucleo() {
  const contexto = vm.createContext({ console });   // sem SpreadsheetApp, DriveApp etc.
  vm.runInContext(fs.readFileSync(ARQUIVO, "utf8"), contexto, { filename: "nucleo.js" });
  return contexto.RoniVet;
}

test("web/nucleo.js está atualizado em relação a src/", () => {
  assert.equal(fs.readFileSync(ARQUIVO, "utf8"), montar());
});

test("o núcleo carrega isolado e registra as rotas do domínio", () => {
  const R = carregarNucleo();
  assert.ok(R.criarApi && R.criarRepositorioMemoria && R.criarTx);
  assert.ok(R.ROTAS.length > 30, `rotas registradas: ${R.ROTAS.length}`);
  assert.equal(R.criarRepositorioPlanilhas, undefined);
  assert.equal(R.montarApi, undefined);
});

test("não inclui módulos específicos do Google", () => {
  const lista = modulos();
  for (const f of lista) {
    assert.ok(!/^(8|9)\d_/.test(f) || f === "84_manutencao.js", f);
    assert.notEqual(f, "71_convites.js");
  }
});
