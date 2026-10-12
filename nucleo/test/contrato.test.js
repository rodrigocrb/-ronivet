"use strict";
// Executa os cenários de contrato (../../contrato/*.json) contra o roteador do núcleo com o
// repositório em memória. O mesmo conjunto roda no modo do aparelho (jstests/contrato_local).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { criarAmbienteDeTeste } = require("./ambiente");

const PASTA = path.join(__dirname, "..", "..", "contrato");

const { substituir, casa, extrair } = require("./contrato_util");

const arquivos = fs.readdirSync(PASTA).filter((f) => f.endsWith(".json")).sort();

for (const arquivo of arquivos) {
  const cenario = JSON.parse(fs.readFileSync(path.join(PASTA, arquivo), "utf8"));
  test(`contrato: ${arquivo.replace(/\.json$/, "")}`, () => {
    const e = criarAmbienteDeTeste();
    const hojeIso = e.amb.agora().slice(0, 10);
    const amanhaIso = e.R.tempo.somarDias(hojeIso, 1);
    const variaveis = { hoje: hojeIso, amanha: amanhaIso };
    cenario.passos.forEach((passo, i) => {
      const caminho = substituir(passo.caminho, variaveis);
      const corpo = substituir(passo.corpo, variaveis);
      const r = e.chamar(passo.como || null, passo.metodo, caminho, corpo);
      const rotulo = `${arquivo} passo ${i + 1} (${passo.metodo} ${caminho})`;
      const esperado = passo.espera || {};
      if ("status" in esperado) {
        assert.equal(r.status, esperado.status, `${rotulo}: ${r.status} ${JSON.stringify(r.corpo).slice(0, 300)}`);
      }
      const ehArquivo = r.corpo && r.corpo.tipo_conteudo;   // PDF/CSV: só o status é conferido
      if ("corpo" in esperado && !ehArquivo) {
        const erro = casa(substituir(esperado.corpo, variaveis), r.corpo);
        assert.equal(erro, null, `${rotulo}: ${erro}\nresposta: ${JSON.stringify(r.corpo).slice(0, 500)}`);
      }
      for (const [nome, onde] of Object.entries(passo.guardar || {})) {
        variaveis[nome] = extrair(r.corpo, onde);
      }
    });
  });
}
