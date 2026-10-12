"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const pdf = require("../web/pdf-texto");
const A = require("../web/ambiente-local");

const texto = (b) => Buffer.from(b).toString("latin1");

test("estrutura válida: cabeçalho, tabela xref com deslocamentos corretos e fim", () => {
  const b = pdf.gerar({ titulo: "Vacina", blocos: [{ texto: "Olá", estilo: "normal" }] });
  const s = texto(b);
  assert.ok(s.startsWith("%PDF-1.4"));
  assert.ok(s.trimEnd().endsWith("%%EOF"));
  const xref = Number(/startxref\n(\d+)/.exec(s)[1]);
  assert.equal(s.slice(xref, xref + 4), "xref");
  const total = Number(/xref\n0 (\d+)/.exec(s)[1]);
  const entradas = [...s.slice(xref).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
  assert.equal(entradas.length, total - 1);
  entradas.forEach((pos, i) => assert.equal(s.slice(pos, pos + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
});

test("o texto com acentos e símbolos é extraído de volta, linha a linha", () => {
  const entrada = "Ação: vacinação — Fêmea (3 anos) \ barra · ok";
  const b = pdf.gerar({ titulo: "T", blocos: [{ texto: entrada, estilo: "normal" }] });
  assert.equal(pdf.extrairTexto(b), entrada);
});

test("linhas longas são quebradas e palavras gigantes não estouram a margem", () => {
  const longa = "palavra ".repeat(60).trim();
  const gigante = "x".repeat(300);
  const b = pdf.gerar({ titulo: "T", blocos: [{ texto: `${longa}\n${gigante}`, estilo: "normal" }] });
  const linhas = pdf.extrairTexto(b).split("\n");
  assert.ok(linhas.length > 4);
  assert.equal(linhas.slice(0, -3).join(" ").includes(longa), true);
  assert.equal(linhas.filter((l) => l.startsWith("xxx")).join(""), gigante);
});

test("paginação: textos longos viram várias páginas sem perder linhas", () => {
  const corpo = Array.from({ length: 140 }, (_, i) => `linha ${i + 1}`).join("\n");
  const b = pdf.gerar({ titulo: "T", blocos: [{ texto: corpo, estilo: "normal" }] });
  assert.ok(pdf.paginas(b) >= 3);
  const extraido = pdf.extrairTexto(b).split("\n");
  assert.equal(extraido.length, 140);
  assert.equal(extraido[139], "linha 140");
});

test("determinístico: mesmo conteúdo, mesmos bytes (mesmo hash); conteúdo diferente, hash diferente", () => {
  const um = pdf.gerar({ titulo: "T", blocos: [{ texto: "a\nb", estilo: "normal" }] });
  const dois = pdf.gerar({ titulo: "T", blocos: [{ texto: "a\nb", estilo: "normal" }] });
  const tres = pdf.gerar({ titulo: "T", blocos: [{ texto: "a\nc", estilo: "normal" }] });
  assert.equal(A.sha256(um), A.sha256(dois));
  assert.notEqual(A.sha256(um), A.sha256(tres));
});

test("caracteres fora do WinAnsi viram ? sem quebrar o arquivo", () => {
  const b = pdf.gerar({ titulo: "日本", blocos: [{ texto: "日本語 ok", estilo: "normal" }] });
  assert.equal(pdf.extrairTexto(b), "??? ok");
  assert.ok(texto(b).startsWith("%PDF"));
});
