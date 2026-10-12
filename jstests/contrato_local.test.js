"use strict";
// Executa os cenários de contrato (contrato/*.json) pelo modo local: núcleo empacotado sobre o
// repositório local, ambiente determinístico e transporte local. Diferenças assumidas do modo
// de aparelho: o encerramento não gera o PDF (o documento é gerado depois, pelo Drive), então
// `documento`/`hash_sha256` do encerramento não se aplicam e a verificação é feita ao abrir.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { criarNuvem } = require("./drive_memoria");
const { substituir, casa, extrair } = require("../nucleo/test/contrato_util");
const { criarBase, criarAparelho } = require("./aparelho_util");

const PASTA = path.join(__dirname, "..", "contrato");

/** Expectativas do contrato que, por desenho, mudam no aparelho. */
function ajustar(passo, esperado) {
  if (!esperado || !("corpo" in esperado)) return esperado;
  const corpo = esperado.corpo;
  if (/\/encerrar$/.test(passo.caminho) && corpo && typeof corpo === "object") {
    const { documento, hash_sha256: hash, ...resto } = corpo;   // eslint-disable-line no-unused-vars
    return { ...esperado, corpo: resto };
  }
  if (/\/verificacao$/.test(passo.caminho) && corpo && corpo.ok === true) {
    return { ...esperado, corpo: { ...corpo, ok: "$qualquer" } };
  }
  return esperado;
}

for (const arquivo of fs.readdirSync(PASTA).filter((f) => f.endsWith(".json")).sort()) {
  const cenario = JSON.parse(fs.readFileSync(path.join(PASTA, arquivo), "utf8"));
  test(`contrato [local]: ${arquivo.replace(/\.json$/, "")}`, async () => {
    const base = await criarBase({ semHorarios: true });
    const ap = await criarAparelho({ nome: "C", base });
    const nuvem = criarNuvem();
    const fluxo = ap.fluxoCom(nuvem.cliente("C"));
    const hoje = "2026-10-11";
    const variaveis = { hoje, amanha: ap.R.tempo.somarDias(hoje, 1) };
    let i = 0;
    for (const passo of cenario.passos) {
      i += 1;
      const caminho = substituir(passo.caminho, variaveis);
      const corpo = substituir(passo.corpo, variaveis);
      const r = await ap.t.rede(caminho, { method: passo.metodo,
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        credencial: passo.como ? `fake:${passo.como}` : null });
      const dados = await r.json();
      const rotulo = `${arquivo} passo ${i} (${passo.metodo} ${caminho})`;
      const esperado = ajustar(passo, passo.espera || {});
      if ("status" in esperado) {
        assert.equal(r.status, esperado.status, `${rotulo}: ${r.status} ${JSON.stringify(dados).slice(0, 300)}`);
      }
      const ehArquivo = dados && dados.tipo_conteudo;
      if ("corpo" in esperado && !ehArquivo) {
        const erro = casa(substituir(esperado.corpo, variaveis), dados);
        assert.equal(erro, null, `${rotulo}: ${erro}\nresposta: ${JSON.stringify(dados).slice(0, 500)}`);
      }
      for (const [nome, onde] of Object.entries(passo.guardar || {})) {
        variaveis[nome] = extrair(dados, onde);
      }
      // O documento é gerado depois do encerramento, quando há conexão com o Drive.
      if (/\/encerrar$/.test(caminho) && r.status === 200) await fluxo.gerarPendentes();
    }
  });
}
