"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("../web/documento-ui");

const DOC = { base64: "JVBERi0xLjQ=", nome_arquivo: "atendimento-at 1/ç.pdf" };

test("no Android grava em arquivo temporário e abre pelo visualizador", async () => {
  const chamadas = [];
  const ambiente = { nativo: true, plugins: {
    Filesystem: { async writeFile(o) { chamadas.push(["gravar", o]); return { uri: "file:///cache/x.pdf" }; } },
    FileOpener: { async open(o) { chamadas.push(["abrir", o]); } } } };
  const r = await U.abrir(DOC, ambiente);
  assert.equal(r.destino, "visualizador");
  assert.equal(chamadas[0][1].directory, "CACHE");
  assert.equal(chamadas[0][1].data, DOC.base64);
  assert.match(chamadas[0][1].path, /^[A-Za-z0-9._-]+\.pdf$/);
  assert.deepEqual(chamadas[1][1], { filePath: "file:///cache/x.pdf", contentType: "application/pdf" });
  const p = await U.imprimir(DOC, ambiente);
  assert.equal(p.destino, "visualizador", "no Android imprime pelo visualizador");
});

test("no navegador abre em nova aba e imprime por iframe oculto", async () => {
  const abertas = [];
  const filhos = [];
  const quadro = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(e, f) { this.carga = f; },
    contentWindow: { focus() {}, print() { quadro.impresso = true; } } };
  const ambiente = { nativo: false, janela: { open: (u, a) => abertas.push([u, a]) },
    documento: { createElement: () => quadro, body: { append: (x) => filhos.push(x) } },
    decodificar: (b) => Buffer.from(b, "base64"), criarUrl: (bytes, tipo) => `blob:${tipo}:${bytes.length}` };
  const r = await U.abrir(DOC, ambiente);
  assert.equal(r.destino, "aba");
  assert.deepEqual(abertas, [["blob:application/pdf:8", "_blank"]]);
  await U.imprimir(DOC, ambiente);
  assert.equal(filhos.length, 1);
  quadro.carga();
  assert.equal(quadro.impresso, true);
});

test("sem documento: erro claro", async () => {
  await assert.rejects(() => U.abrir({}, { nativo: false }), /indisponível/);
  await assert.rejects(() => U.imprimir(null, { nativo: false }), /indisponível/);
});
