/* CPF: normalização, validação dos dígitos verificadores e máscara. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};

(function (R) {
  "use strict";

  const cpf = {
    normalizar(texto) {
      return R.apenasDigitos(texto);
    },

    /** 11 dígitos, não todos iguais, dígitos verificadores corretos. */
    valido(texto) {
      const d = cpf.normalizar(texto);
      if (d.length !== 11 || new Set(d.split("")).size === 1) return false;
      for (const tamanho of [9, 10]) {
        let soma = 0;
        for (let i = 0; i < tamanho; i += 1) soma += Number(d[i]) * (tamanho + 1 - i);
        const digito = ((soma * 10) % 11) % 10;
        if (digito !== Number(d[tamanho])) return false;
      }
      return true;
    },

    /** Oculta os dígitos centrais para listas e auditoria: ***.456.789-**. */
    mascarar(texto) {
      const d = cpf.normalizar(texto);
      if (d.length !== 11) return "***";
      return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
    },
  };

  R.cpf = cpf;
})(RoniVet);
