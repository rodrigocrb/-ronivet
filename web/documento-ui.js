"use strict";
// Abrir e imprimir o PDF do atendimento. O documento chega do contrato em base64 (no modo
// local não há URL para apontar). No navegador vira um Blob; no Android é gravado em arquivo
// temporário e aberto por um visualizador externo (que oferece imprimir e compartilhar),
// porque window.print não imprime PDF dentro do WebView.
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.RoniDocumentoUi = api;
})(typeof self !== "undefined" ? self : this, function () {
  const TIPO = "application/pdf";

  function nomeSeguro(nome) {
    return String(nome || "documento.pdf").replace(/[^A-Za-z0-9._-]/g, "_");
  }

  /**
   * ambiente: { nativo: bool, plugins: { Filesystem, FileOpener }, janela, documento,
   *             decodificar(base64) -> Uint8Array, criarUrl(bytes, tipo) -> url, revogar(url) }
   * `doc`: { base64, nome_arquivo } (resposta de /documento).
   */
  async function abrir(doc, ambiente) {
    if (!doc || !doc.base64) throw new Error("documento indisponível");
    const nome = nomeSeguro(doc.nome_arquivo);
    const tipo = doc.tipo_conteudo || TIPO;
    if (ambiente.nativo) {
      const { Filesystem, FileOpener } = ambiente.plugins;
      const r = await Filesystem.writeFile({ path: nome, data: doc.base64, directory: "CACHE" });
      await FileOpener.open({ filePath: r.uri, contentType: tipo });
      return { destino: "visualizador", uri: r.uri };
    }
    const url = ambiente.criarUrl(ambiente.decodificar(doc.base64), tipo);
    ambiente.janela.open(url, "_blank");
    return { destino: "aba", url };
  }

  /** Imprimir: no Android usa o visualizador (que imprime); no navegador, um iframe oculto. */
  async function imprimir(doc, ambiente) {
    if (ambiente.nativo) return abrir(doc, ambiente);
    if (!doc || !doc.base64) throw new Error("documento indisponível");
    const url = ambiente.criarUrl(ambiente.decodificar(doc.base64), TIPO);
    const quadro = ambiente.documento.createElement("iframe");
    quadro.setAttribute("style", "position:fixed;width:0;height:0;border:0");
    quadro.src = url;
    quadro.addEventListener("load", () => {
      quadro.contentWindow.focus();
      quadro.contentWindow.print();
    });
    ambiente.documento.body.append(quadro);
    return { destino: "impressao", url };
  }

  /** Ambiente real do navegador/Capacitor. */
  function ambienteDoNavegador(janela) {
    const cap = janela.Capacitor;
    const nativo = Boolean(cap && cap.isNativePlatform && cap.isNativePlatform());
    return {
      nativo,
      plugins: nativo ? {
        Filesystem: cap.Plugins && cap.Plugins.Filesystem,
        FileOpener: cap.Plugins && cap.Plugins.FileOpener,
      } : {},
      janela,
      documento: janela.document,
      decodificar(b64) {
        const bin = janela.atob(b64);
        const b = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) b[i] = bin.charCodeAt(i);
        return b;
      },
      criarUrl: (bytes, tipo) => janela.URL.createObjectURL(new janela.Blob([bytes], { type: tipo })),
      revogar: (url) => janela.URL.revokeObjectURL(url),
    };
  }

  return { abrir, imprimir, ambienteDoNavegador, nomeSeguro };
});
