"use strict";
// Substituição de variáveis e comparação parcial usadas pelo executor de contrato.

function substituir(valor, variaveis) {
  if (typeof valor === "string") {
    if (valor.startsWith("@") && Object.prototype.hasOwnProperty.call(variaveis, valor.slice(1))) {
      return variaveis[valor.slice(1)];
    }
    return valor.replace(/\{(\w+)\}/g, (m, nome) => (
      Object.prototype.hasOwnProperty.call(variaveis, nome) ? String(variaveis[nome]) : m));
  }
  if (Array.isArray(valor)) return valor.map((v) => substituir(v, variaveis));
  if (valor && typeof valor === "object") {
    const saida = {};
    for (const [k, v] of Object.entries(valor)) saida[k] = substituir(v, variaveis);
    return saida;
  }
  return valor;
}

/** Comparação parcial; devolve null se casa, ou a descrição da diferença. */
function casa(esperado, atual, caminho = "corpo") {
  if (esperado === "$qualquer") return null;
  if (esperado === "$nulo") return atual === null || atual === undefined ? null : `${caminho}: esperado nulo, veio ${JSON.stringify(atual)}`;
  if (esperado === "$presente") return atual !== null && atual !== undefined ? null : `${caminho}: esperado valor, veio nulo`;
  if (esperado !== null && typeof esperado === "object" && !Array.isArray(esperado)) {
    if (atual === null || typeof atual !== "object") {
      return `${caminho}: esperado objeto, veio ${JSON.stringify(atual)}`;
    }
    if (Array.isArray(atual)) {
      if ("$tamanho" in esperado && atual.length !== esperado.$tamanho) {
        return `${caminho}: tamanho ${atual.length} != ${esperado.$tamanho}`;
      }
      if ("$contem" in esperado && !atual.some((i) => casa(esperado.$contem, i, caminho) === null)) {
        return `${caminho}: nenhum item casa com ${JSON.stringify(esperado.$contem)} em ${JSON.stringify(atual)}`;
      }
      return null;
    }
    for (const [chave, valor] of Object.entries(esperado)) {
      if (chave.startsWith("$")) continue;
      if (!(chave in atual)) return `${caminho}.${chave}: ausente`;
      const erro = casa(valor, atual[chave], `${caminho}.${chave}`);
      if (erro) return erro;
    }
    return null;
  }
  if (Array.isArray(esperado)) {
    if (!Array.isArray(atual) || atual.length !== esperado.length) {
      return `${caminho}: lista esperada ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`;
    }
    for (let i = 0; i < esperado.length; i += 1) {
      const erro = casa(esperado[i], atual[i], `${caminho}[${i}]`);
      if (erro) return erro;
    }
    return null;
  }
  return esperado === atual ? null : `${caminho}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(atual)}`;
}

function extrair(corpo, caminho) {
  let atual = corpo;
  for (const parte of caminho.split(".")) atual = atual[Array.isArray(atual) ? Number(parte) : parte];
  return atual;
}

module.exports = { substituir, casa, extrair };
