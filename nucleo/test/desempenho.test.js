"use strict";
// Volume de uso do consultório: 3.000 tutores, ~4.500 animais e 5.000 atendimentos.
// Mede o custo da lógica de domínio no adaptador em memória. Os limites aqui são folgados: servem
// para pegar regressões de complexidade (laços quadráticos), não para benchmark.
const test = require("node:test");
const assert = require("node:assert/strict");
const { criarAmbienteDeTeste } = require("./ambiente");

const TUTORES = 3000;
const ATENDIMENTOS = 5000;

function cpfDe(n) {
  const base = String(n).padStart(9, "0");
  const d = base.split("").map(Number);
  for (const tamanho of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < tamanho; i += 1) soma += d[i] * (tamanho + 1 - i);
    d.push(((soma * 10) % 11) % 10);
  }
  return d.join("");
}

function semearVolume() {
  const e = criarAmbienteDeTeste();
  e.expediente("08:00", "18:00");
  const R = e.R;
  const agora = "2026-01-01T00:00:00-03:00";
  const lote = [];
  const animais = [];
  const especies = ["Cão", "Gato", "Ave", "Equino"];
  const sexos = ["MACHO", "FEMEA", "INDEFINIDO"];
  for (let i = 0; i < TUTORES; i += 1) {
    lote.push({ tabela: "Tutor", tipo: "inserir", linha: R.completarLinha("Tutor", {
      id_tutor: `t${i}`, nome: `Tutor ${String(i).padStart(5, "0")} Silva`,
      telefone: `1199${String(i).padStart(7, "0")}`, cpf: cpfDe(1000 + i),
      aceita_contato: i % 2 ? "SIM" : "NAO", criado_em: agora, criado_por: "x",
      atualizado_em: agora, atualizado_por: "x" }) });
    for (let j = 0; j < (i % 2 ? 2 : 1); j += 1) {
      const id = `a${i}-${j}`;
      animais.push(id);
      lote.push({ tabela: "Animal", tipo: "inserir", linha: R.completarLinha("Animal", {
        id_animal: id, id_tutor: `t${i}`, nome: `Pet${i}-${j}`, especie: especies[(i + j) % 4],
        sexo: sexos[(i + j) % 3], criado_em: agora, criado_por: "x", atualizado_em: agora,
        atualizado_por: "x" }) });
    }
  }
  for (let k = 0; k < ATENDIMENTOS; k += 1) {
    const dia = new Date(Date.UTC(2025, 0, 1 + (k % 600)));
    const iso = dia.toISOString().slice(0, 10);
    const id = `at${k}`;
    const animal = animais[(k * 7) % animais.length];
    lote.push({ tabela: "Atendimento", tipo: "inserir", linha: R.completarLinha("Atendimento", {
      id_atendimento: id, id_animal: animal, id_tipo: "tipo-vacina",
      inicio: `${iso}T${String(8 + (k % 10)).padStart(2, "0")}:${k % 2 ? "30" : "00"}`,
      duracao_min: 30, status: k % 3 === 2 ? "AGENDADO" : "ENCERRADO", criado_em: agora,
      criado_por: "x", atualizado_em: agora, atualizado_por: "x" }) });
    if (k % 3 === 0) {
      lote.push({ tabela: "Vacina", tipo: "inserir", linha: R.completarLinha("Vacina", {
        id_vacina: `v${k}`, id_animal: animal, id_atendimento: id, produto: k % 2 ? "V10" : "V4",
        lote: "L", data_aplicacao: iso, criado_em: agora }) });
    }
  }
  e.repo.aplicar(lote);
  return e;
}

function medir(rotulo, fn, repeticoes = 5) {
  const tempos = [];
  let resultado;
  for (let i = 0; i < repeticoes; i += 1) {
    const t0 = process.hrtime.bigint();
    resultado = fn(i);
    tempos.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  tempos.sort((a, b) => a - b);
  const mediana = tempos[Math.floor(tempos.length / 2)];
  console.log(`  ${rotulo.padEnd(34)} mediana ${mediana.toFixed(1).padStart(8)} ms`);
  return { mediana, resultado };
}

test(`volume (${TUTORES} tutores, ${ATENDIMENTOS} atendimentos): telas principais`, () => {
  const e = semearVolume();
  const sec = (m, c, b) => e.chamar("sec@c.com", m, c, b);
  const adm = (m, c, b) => e.chamar("admin@c.com", m, c, b);
  console.log("\n  Tempo da lógica em memória (sem o custo das planilhas):");
  const limite = 3000;

  const agenda = medir("Agenda do dia", () => sec("GET", "/api/agenda?de=2025-06-01"));
  assert.equal(agenda.resultado.status, 200);
  const busca = medir("Busca de tutor por nome", () => sec("GET", "/api/tutores?q=" + encodeURIComponent("Tutor 0123")));
  assert.ok(busca.resultado.corpo.length >= 1);
  const cpf = medir("Busca de tutor por CPF", () => sec("GET", `/api/tutores?cpf=${cpfDe(1000 + 1234)}`));
  assert.equal(cpf.resultado.corpo.length, 1);
  const bAt = medir("Busca de atendimentos", () => sec("GET", "/api/busca?q=Tutor%2001"));
  assert.equal(bAt.resultado.status, 200);
  const painel = medir("Painel (ano)", () => adm("GET", "/api/dashboard?de=2025-01-01&ate=2026-12-31"));
  assert.ok(painel.resultado.corpo.total > 0);
  const camp = medir("Campanha (30 dias)", () => sec("GET", "/api/campanha?hoje=2026-06-01&dias=30"));
  assert.equal(camp.resultado.status, 200);

  const composto = medir("Agendamento composto (POST)", (i) => sec("POST", "/api/agendamentos", {
    id: `novo-${i}`, inicio: `2030-03-${String(11 + (i % 5)).padStart(2, "0")}T${8 + i}:00`,
    id_tipo: "tipo-vacina",
    tutor: { nome: `Novo ${i}`, telefone: `1188${i}`, cpf: cpfDe(900000 + i) },
    animal: { nome: `Pet ${i}`, especie: "Cão" } }), 4);
  assert.equal(composto.resultado.status, 201, JSON.stringify(composto.resultado.corpo));

  for (const m of [agenda, busca, cpf, bAt, painel, camp, composto]) {
    assert.ok(m.mediana < limite, `lento demais: ${m.mediana.toFixed(0)} ms`);
  }
});
