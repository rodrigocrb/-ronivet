"use strict";
// Regras da configuração de tipos como questionário (testável em Node, sem navegador).

(function (global) {
  // Como o administrador enxerga o "tipo de resposta" de cada pergunta.
  const ROTULO_RESPOSTA = {
    TEXTO: "Texto", NUMERO: "Número", DATA: "Data", LISTA: "Escolha uma opção", SIMNAO: "Sim ou não",
  };

  // Marcadores fornecidos pelo sistema (espelham R.documentos.MARCADORES_RESERVADOS do núcleo).
  const MARCADORES_RESERVADOS = [
    "tutor_nome", "tutor_telefone", "tutor_cpf", "tutor_email", "tutor_endereco",
    "animal_nome", "animal_especie", "animal_sexo", "animal_raca",
    "animal_data_nascimento", "animal_pelagem",
    "atendimento_id", "atendimento_tipo", "atendimento_data", "atendimento_hora",
    "atendimento_encerrado_em", "veterinario_nome", "veterinario_crmv",
  ];
  const PREFIXOS_RESERVADOS = ["tutor_", "animal_", "atendimento_", "veterinario_"];

  // "Peso do animal (kg)" -> "peso_do_animal_kg"; garante nome válido e único entre os usados.
  function nomeTecnico(rotulo, usados = []) {
    let base = String(rotulo || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40)
      .replace(/_+$/, "");
    if (!base) base = "pergunta";
    if (/^[0-9]/.test(base)) base = `p_${base}`;
    if (PREFIXOS_RESERVADOS.some((p) => base.startsWith(p))) base = `campo_${base}`;
    const ocupados = new Set(usados);
    let nome = base;
    for (let n = 2; ocupados.has(nome); n += 1) nome = `${base}_${n}`;
    return nome;
  }

  // Lê "Cão, Gato; Ave" ou uma lista e devolve as opções sem vazios e sem repetições.
  function listarOpcoes(texto) {
    const itens = Array.isArray(texto) ? texto : String(texto || "").split(/[,;\n]/);
    const vistos = new Set();
    return itens.map((s) => String(s).trim()).filter((s) => {
      if (!s || vistos.has(s.toLowerCase())) return false;
      vistos.add(s.toLowerCase());
      return true;
    });
  }

  // Posições 1..n a partir da lista já na ordem desejada; devolve só o que mudou.
  function novasOrdens(campos) {
    return campos
      .map((c, i) => ({ id: c.id, ordem: i + 1, atual: c.ordem }))
      .filter((c) => c.ordem !== c.atual)
      .map(({ id, ordem }) => ({ id, ordem }));
  }

  function mover(campos, indice, delta) {
    const destino = indice + delta;
    if (destino < 0 || destino >= campos.length) return campos.slice();
    const copia = campos.slice();
    [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
    return copia;
  }

  const api = { ROTULO_RESPOSTA, MARCADORES_RESERVADOS, nomeTecnico, listarOpcoes, novasOrdens, mover };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.RoniTipos = api;
})(typeof window !== "undefined" ? window : globalThis);
