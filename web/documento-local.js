"use strict";
// Porta de documentos do núcleo, para o aparelho (design 7): modelo -> texto preenchido -> PDF.
// O modelo de um tipo pode ser o padrão (derivado dos campos) ou um texto próprio, guardado na
// própria coluna do tipo com o prefixo "texto:" (assim ele é replicado como qualquer dado).
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.RoniDocumentoLocal = api;
})(typeof self !== "undefined" ? self : this, function () {
  const PREFIXO = "texto:";

  /** `R`: núcleo; `pdf`: RoniPdfTexto. */
  function criarDocumentosLocais({ R, pdf }) {
    const D = R.documentos;

    const REF_DOCX = /^docx:([0-9a-f]{64})(?::([a-z0-9_,]*))?$/;

    function textoDoModelo(modeloId) {
      if (typeof modeloId !== "string" || !modeloId.startsWith(PREFIXO)) {
        throw new D.FalhaDocumento(`modelo não encontrado: ${modeloId}`);
      }
      return modeloId.slice(PREFIXO.length);
    }

    return {
      PREFIXO,
      /** O núcleo chama ao vincular um modelo: aceita só texto com o prefixo. */
      resolverModelo(referencia) {
        const t = String(referencia).trim();
        if (REF_DOCX.test(t)) return t;
        return t.startsWith(PREFIXO) ? t : `${PREFIXO}${t}`;
      },
      listarModelos: () => [],
      /**
       * `docx:<sha256>:<marcadores separados por vírgula>`: o modelo .docx fica no Drive e os
       * marcadores vão na própria referência, para que todo aparelho valide igual ao reaplicar.
       */
      ehDocx: (modeloId) => REF_DOCX.test(String(modeloId || "")),
      shaDoDocx(modeloId) {
        const m = REF_DOCX.exec(String(modeloId || ""));
        return m ? m[1] : null;
      },
      marcadoresDoModelo(modeloId) {
        const m = REF_DOCX.exec(String(modeloId || ""));
        if (m) return (m[2] || "").split(",").filter(Boolean);
        return [...D.marcadoresDoTexto(textoDoModelo(modeloId))];
      },

      /** PDF (Uint8Array) do atendimento; falha com FalhaDocumento se faltar marcador. */
      renderizar({ modeloId, titulo, campos, valores, identificacao }) {
        if (REF_DOCX.test(String(modeloId || ""))) {
          throw new D.FalhaDocumento("modelo .docx é convertido pelo Drive, não no aparelho");
        }
        const base = modeloId ? textoDoModelo(modeloId) : D.textoModeloPadrao(titulo, campos);
        const texto = D.preencherTexto(base, valores);
        const [primeira, ...resto] = texto.split("\n");
        const blocos = [{ texto: primeira, estilo: "titulo" }];
        if (resto.length) blocos.push({ texto: resto.join("\n"), estilo: "normal" });
        blocos.push({ texto: "", estilo: "normal" });
        blocos.push({ texto: identificacao.join("\n"), estilo: "nota" });
        return pdf.gerar({ titulo, blocos });
      },
    };
  }

  return { criarDocumentosLocais };
});
