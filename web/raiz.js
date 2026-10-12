"use strict";
// Descoberta e criação da pasta da clínica no Drive (design 5), com reconciliação de pastas
// duplicadas criadas por dois aparelhos ao mesmo tempo. Trabalha sobre uma API de pastas
// mínima, que o cliente REST (ou um fake de teste) implementa:
//   listarPastas(nome)      -> [{ id, criadaEm }]       (apenas as que o aplicativo enxerga)
//   criarPasta(nome)        -> { id, criadaEm }
//   listarFilhos(idPasta)   -> [{ id, nome, ehPasta }]
//   mover(idItem, deId, paraId)
//   excluirPasta(idPasta)
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.RoniRaiz = api;
})(typeof self !== "undefined" ? self : this, function () {
  /** A pasta mais antiga vence; empate pelo id. Mesma escolha em todos os aparelhos. */
  function escolher(pastas) {
    return [...pastas].sort((a, b) => (a.criadaEm !== b.criadaEm
      ? (a.criadaEm < b.criadaEm ? -1 : 1) : (a.id < b.id ? -1 : 1)))[0];
  }

  /**
   * `reconciliar: false` não move nem exclui pastas duplicadas.
   * Devolve { id, criada, reconciliada }. `criar: false` só procura (retorna null se não há).
   * `criada`: este aparelho criou a pasta que ficou como a da clínica.
   */
  async function abrirRaiz({ api: drive, nome = "RoniVet", criar = true, reconciliar = true }) {
    let pastas = await drive.listarPastas(nome);
    let minha = null;
    if (!pastas.length) {
      if (!criar) return null;
      minha = await drive.criarPasta(nome);
      pastas = await drive.listarPastas(nome);
      if (!pastas.some((p) => p.id === minha.id)) pastas.push(minha);   // listagem defasada
    }
    const vencedora = escolher(pastas);
    let reconciliada = false;
    for (const p of pastas) {
      if (p.id === vencedora.id) continue;
      // Com acesso amplo ao Drive (pessoas com contas diferentes) não se mexe em pastas de
      // outras contas: só se escolhe a mais antiga, igual em todos os aparelhos.
      if (!reconciliar) continue;
      // Duplicada: leva o conteúdo (só o que este aplicativo criou é visível) para a vencedora.
      for (const filho of await drive.listarFilhos(p.id)) {
        await drive.mover(filho.id, p.id, vencedora.id);
      }
      try { await drive.excluirPasta(p.id); } catch (_) { /* melhor esforço */ }
      reconciliada = true;
    }
    return { id: vencedora.id, criada: Boolean(minha && minha.id === vencedora.id), reconciliada };
  }

  return { abrirRaiz, escolher };
});
