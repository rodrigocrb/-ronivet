/* Validação de corpos de requisição. Erros de validação respondem 422 com `detail` em lista. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};

(function (R) {
  "use strict";

  const tem = (corpo, chave) => corpo !== null && typeof corpo === "object"
    && Object.prototype.hasOwnProperty.call(corpo, chave);

  const invalido = (campo, msg) => R.erro(422, [{ loc: ["body", campo], msg, type: "value_error" }]);

  function objeto(corpo) {
    if (corpo === undefined || corpo === null) return {};
    if (typeof corpo !== "object" || Array.isArray(corpo)) {
      throw R.erro(422, [{ loc: ["body"], msg: "corpo deve ser um objeto", type: "type_error" }]);
    }
    return corpo;
  }

  /** Texto obrigatório (pode vir vazio; use `preenchido` para exigir conteúdo). */
  function textoObrigatorio(corpo, campo) {
    if (!tem(corpo, campo) || corpo[campo] === null) throw invalido(campo, "Field required");
    if (typeof corpo[campo] !== "string") throw invalido(campo, "Input should be a valid string");
    return corpo[campo];
  }

  function preenchido(corpo, campo) {
    const valor = textoObrigatorio(corpo, campo).trim();
    if (!valor) throw invalido(campo, "campo obrigatório");
    return valor;
  }

  /** Texto opcional: undefined (ausente), null ou string. */
  function textoOpcional(corpo, campo) {
    if (!tem(corpo, campo)) return undefined;
    const v = corpo[campo];
    if (v === null) return null;
    if (typeof v !== "string") throw invalido(campo, "Input should be a valid string");
    return v;
  }

  function inteiroOpcional(corpo, campo) {
    if (!tem(corpo, campo) || corpo[campo] === null) return null;
    const v = corpo[campo];
    if (typeof v !== "number" || !Number.isInteger(v)) throw invalido(campo, "Input should be a valid integer");
    return v;
  }

  function inteiroObrigatorio(corpo, campo) {
    if (!tem(corpo, campo) || corpo[campo] === null) throw invalido(campo, "Field required");
    return inteiroOpcional(corpo, campo);
  }

  function boolObrigatorio(corpo, campo) {
    if (!tem(corpo, campo) || corpo[campo] === null) throw invalido(campo, "Field required");
    if (typeof corpo[campo] !== "boolean") throw invalido(campo, "Input should be a valid boolean");
    return corpo[campo];
  }

  function boolOpcional(corpo, campo, padrao) {
    if (!tem(corpo, campo) || corpo[campo] === null) return padrao;
    if (typeof corpo[campo] !== "boolean") throw invalido(campo, "Input should be a valid boolean");
    return corpo[campo];
  }

  function opcao(valor, campo, permitidos) {
    if (!permitidos.includes(valor)) {
      throw invalido(campo, `Input should be ${permitidos.map((p) => `'${p}'`).join(", ")}`);
    }
    return valor;
  }

  /** CPF opcional: vazio vira null; informado precisa ser válido e fica só com os dígitos. */
  function cpfOpcional(valor) {
    if (valor === null || valor === undefined || !String(valor).trim()) return null;
    if (!R.cpf.valido(valor)) throw invalido("cpf", "CPF inválido");
    return R.cpf.normalizar(valor);
  }

  R.validar = {
    tem, invalido, objeto, textoObrigatorio, preenchido, textoOpcional, inteiroOpcional,
    inteiroObrigatorio, boolObrigatorio, boolOpcional, opcao, cpfOpcional,
  };
})(RoniVet);
