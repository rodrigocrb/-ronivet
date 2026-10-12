"use strict";
// Executar: node --test jstests
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../web/tipos-util.js");

test("nome técnico vem do rótulo, sem acento e com sublinhado", () => {
  assert.equal(T.nomeTecnico("Peso do animal (kg)"), "peso_do_animal_kg");
  assert.equal(T.nomeTecnico("  Vacina — Próxima dose! "), "vacina_proxima_dose");
  assert.equal(T.nomeTecnico("Observações"), "observacoes");
});

test("nome técnico é sempre válido para o servidor", () => {
  const valido = /^[a-z][a-z0-9_]*$/;
  for (const r of ["", "???", "123 abc", "Ação", "tutor nome", "Animal raça", "_x_"]) {
    const n = T.nomeTecnico(r);
    assert.match(n, valido, `${r} -> ${n}`);
    assert.ok(!/^(tutor_|animal_|atendimento_|veterinario_)/.test(n), `${r} -> ${n}`);
  }
  assert.equal(T.nomeTecnico("123 abc"), "p_123_abc");
  assert.equal(T.nomeTecnico("Tutor nome"), "campo_tutor_nome");
});

test("nome técnico não repete os já usados", () => {
  assert.equal(T.nomeTecnico("Peso", ["peso"]), "peso_2");
  assert.equal(T.nomeTecnico("Peso", ["peso", "peso_2"]), "peso_3");
});

test("opções: separadas por vírgula, sem vazios nem repetidas", () => {
  assert.deepEqual(T.listarOpcoes("Cão, Gato; ave,, cão"), ["Cão", "Gato", "ave"]);
  assert.deepEqual(T.listarOpcoes(["A", " ", "a", "B"]), ["A", "B"]);
});

test("ordem: mover e renumerar só o que mudou", () => {
  const campos = [{ id: "a", ordem: 1 }, { id: "b", ordem: 2 }, { id: "c", ordem: 3 }];
  const sobe = T.mover(campos, 2, -1);
  assert.deepEqual(sobe.map((c) => c.id), ["a", "c", "b"]);
  assert.deepEqual(T.novasOrdens(sobe), [{ id: "c", ordem: 2 }, { id: "b", ordem: 3 }]);
  assert.deepEqual(T.mover(campos, 0, -1).map((c) => c.id), ["a", "b", "c"]);
  assert.deepEqual(T.novasOrdens(campos), []);
});

test("rótulos de resposta em linguagem simples", () => {
  assert.equal(T.ROTULO_RESPOSTA.LISTA, "Escolha uma opção");
  assert.equal(T.ROTULO_RESPOSTA.SIMNAO, "Sim ou não");
});
