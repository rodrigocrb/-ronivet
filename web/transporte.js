"use strict";
// Transporte do aplicativo: o núcleo de regras roda no próprio aparelho (nucleo.js). A chamada
// vai ao roteador local, com ambiente determinístico, e só é respondida depois de gravada de
// forma durável (design 1 e 4 da change app-local-sincronizacao-drive).
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.RoniTransporte = api;
})(typeof self !== "undefined" ? self : this, function () {
  /** Resposta mínima compatível com o que o aplicativo usa de fetch (ok, status, json, text). */
  function resposta(status, corpo) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => corpo,
      text: async () => (typeof corpo === "string" ? corpo : JSON.stringify(corpo)),
    };
  }

  /** ISO com o deslocamento do fuso do aparelho (ex.: 2026-10-11T12:00:00-03:00). */
  function agoraIso(data = new Date()) {
    const p = (n, t = 2) => String(Math.abs(n)).padStart(t, "0");
    const desloc = -data.getTimezoneOffset();
    const sinal = desloc >= 0 ? "+" : "-";
    return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}`
      + `T${p(data.getHours())}:${p(data.getMinutes())}:${p(data.getSeconds())}`
      + `${sinal}${p(Math.floor(Math.abs(desloc) / 60))}:${p(Math.abs(desloc) % 60)}`;
  }

  /**
   * opcoes: { obterCredencial() -> Promise<string|null>,
   *           local: { repo, novoIdOp(), agoraIso(), executar(env) | api + amb } }
   * Devolve { rede(caminho, opcoes), modo }.
   */
  function criarTransporte(opcoes) {
    const obterCredencial = opcoes.obterCredencial || (async () => null);

    /** Roteador local: grava de forma durável antes de responder; leituras não esperam. */
    async function rede(caminho, o = {}) {
      const local = opcoes.local;
      if (!local) throw new TypeError("núcleo local não configurado");
      const metodo = (o.method || "GET").toUpperCase();
      let corpo;
      if (typeof o.body === "string" && o.body) {
        try { corpo = JSON.parse(o.body); } catch (_) { corpo = o.body; }
      } else if (o.body !== undefined) {
        corpo = o.body;
      }
      let credencial = (o.credencial !== undefined) ? o.credencial : await obterCredencial();
      if (!credencial && corpo && typeof corpo === "object" && corpo.credential) {
        credencial = corpo.credential;
      }
      const hora = (local.agoraIso || agoraIso)();
      const idOp = o.idOp || local.novoIdOp();
      const envelope = { metodo, caminho, corpo, idOp: metodo === "GET" ? (o.idOp || undefined) : idOp,
        credencial: credencial || undefined };
      const r = local.executar
        ? local.executar({ ...envelope, hora })
        : local.amb.executarComo({ idOp, hora }, () => local.api.tratar(envelope));
      if (local.repo.descarregar && (metodo !== "GET" || local.repo.pendenteDeGravacao())) {
        try {
          await local.repo.descarregar();
        } catch (_) {
          return resposta(500, { detail: { codigo: "falha_gravacao_local",
            mensagem: "Não foi possível gravar no aparelho. Tente novamente." } });
        }
      }
      return resposta(r.status, r.corpo === undefined ? null : r.corpo);
    }

    return { modo: "local", rede };
  }

  return { criarTransporte, agoraIso };
});
