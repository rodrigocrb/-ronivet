/* RoniVet: núcleo de regras (domínio e roteador), sem dependência de plataforma.
 *
 * Os arquivos de src/ são concatenados em ordem alfabética em web/nucleo.js (montar_nucleo.js).
 * Tudo vive no namespace RoniVet e roda igual no aplicativo e em Node (test/carregar.js). */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};

(function (R) {
  "use strict";

  /** Erro com status HTTP e `detail` (a resposta de erro do roteador é { detail }). */
  class HttpErro extends Error {
    constructor(status, detail) {
      super(typeof detail === "string" ? detail : (detail && detail.mensagem) || "erro");
      this.status = status;
      this.detail = detail;
    }
  }

  R.HttpErro = HttpErro;
  R.erro = (status, detail) => new HttpErro(status, detail);

  R.clonar = (valor) => (valor === undefined ? undefined : JSON.parse(JSON.stringify(valor)));

  R.apenasDigitos = (texto) => String(texto == null ? "" : texto).replace(/\D/g, "");

  /** Minúsculas e sem acentos, para buscas ("joao" encontra "João"). */
  R.normalizar = (texto) => (texto == null ? "" : String(texto)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase());

  R.txt = (valor) => {
    const t = String(valor == null ? "" : valor).trim();
    return t === "" ? null : t;
  };

  R.PERFIS = Object.freeze({ ADMIN: "ADMIN", VETERINARIO: "VETERINARIO", SECRETARIA: "SECRETARIA" });
})(RoniVet);
