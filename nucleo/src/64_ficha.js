/* Ficha clínica do atendimento: campos dinâmicos. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};
RoniVet.ROTAS = RoniVet.ROTAS || [];

(function (R) {
  "use strict";

  const V = R.validar;
  const { CLINICOS } = R.GRUPOS;
  const NUMERO = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

  /** Valores indexados pelo nome do campo (inclui campos já desativados). */
  R.valoresDoAtendimento = (tx, idAtendimento) => {
    const defs = new Map(tx.todos("CampoDef").map((d) => [d.id_campo, d]));
    const saida = {};
    for (const v of tx.todos("CampoValor")) {
      if (v.id_atendimento !== idAtendimento) continue;
      const def = defs.get(v.id_campo);
      if (def) saida[def.nome] = v.valor;
    }
    return saida;
  };

  /** Valida e normaliza um valor conforme o tipo de dado; devolve texto ou null. */
  R.validarValor = function validarValor(campo, valor) {
    if (valor === null || valor === undefined || String(valor).trim() === "") return null;
    const texto = String(valor).trim();
    switch (campo.tipo_dado) {
      case "NUMERO": {
        const n = texto.replace(",", ".");
        if (!NUMERO.test(n)) throw new Error("deve ser um número");
        return n;
      }
      case "DATA":
        if (!R.tempo.dataValida(texto)) throw new Error("deve ser uma data AAAA-MM-DD");
        return texto;
      case "LISTA":
        if (!campo.opcoes.includes(texto)) throw new Error("opção inválida");
        return texto;
      case "SIMNAO":
        if (texto !== "SIM" && texto !== "NAO") throw new Error("deve ser SIM ou NAO");
        return texto;
      default:
        return texto;
    }
  };

  R.ficha = function ficha(tx, atendimento) {
    const campos = R.camposDoTipo(tx, atendimento.id_tipo);
    const valores = R.valoresDoAtendimento(tx, atendimento.id_atendimento);
    // campos desativados com valor preservado continuam aparecendo (somente leitura)
    const ativos = new Set(campos.map((c) => c.nome));
    const comValor = new Set(tx.todos("CampoValor")
      .filter((v) => v.id_atendimento === atendimento.id_atendimento).map((v) => v.id_campo));
    const extras = tx.todos("CampoDef")
      .filter((d) => d.id_tipo === atendimento.id_tipo && d.ativo === "NAO"
        && comValor.has(d.id_campo) && !ativos.has(d.nome))
      .map((d) => ({ nome: d.nome, rotulo: d.rotulo, tipo_dado: d.tipo_dado,
        opcoes: d.opcoes ? d.opcoes.split("|") : [], obrigatorio: false, ordem: d.ordem,
        papel: d.papel, ativo: "NAO" }));
    return {
      id: atendimento.id_atendimento, status: atendimento.status, versao: atendimento.versao,
      editavel: atendimento.status === "AGENDADO", campos: [...campos, ...extras], valores,
    };
  };

  function verFicha(ctx) {
    const { tx } = ctx;
    const at = R.obterAtendimento(tx, ctx.req.params[0]);
    R.auditar(ctx, "CONSULTAR", "Atendimento", at.id_atendimento);
    return { status: 200, corpo: R.ficha(tx, at) };
  }

  function salvarValores(ctx) {
    const { tx, usuario, amb } = ctx;
    const id = ctx.req.params[0];
    const c = V.objeto(ctx.req.corpo);
    if (!V.tem(c, "valores") || c.valores === null || typeof c.valores !== "object"
      || Array.isArray(c.valores)) {
      throw V.invalido("valores", "Field required");
    }
    for (const [k, v] of Object.entries(c.valores)) {
      if (v !== null && typeof v !== "string") {
        throw V.invalido(`valores.${k}`, "Input should be a valid string");
      }
    }
    const versao = V.inteiroObrigatorio(c, "versao");

    const at = R.obterAtendimento(tx, id);
    if (at.status !== "AGENDADO") {
      R.auditar(ctx, "REJEITAR", "Atendimento", id, "valores", at.status, "alteração recusada");
      throw R.erro(409, { codigo: at.status === "ENCERRADO" ? "atendimento_encerrado"
        : "atendimento_cancelado", mensagem: "Atendimento não pode ser alterado." });
    }
    if (versao !== at.versao) {
      throw R.erro(409, { codigo: "versao_desatualizada",
        mensagem: "O atendimento foi alterado por outra pessoa. Recarregue." });
    }
    const campos = new Map(R.camposDoTipo(tx, at.id_tipo).map((x) => [x.nome, x]));
    const desconhecidos = Object.keys(c.valores).filter((n) => !campos.has(n));
    if (desconhecidos.length) {
      throw R.erro(422, { codigo: "campo_desconhecido", campos: desconhecidos });
    }
    const erros = {};
    const normalizados = {};
    for (const [nome, valor] of Object.entries(c.valores)) {
      try {
        normalizados[nome] = R.validarValor(campos.get(nome), valor);
      } catch (e) {
        erros[nome] = e.message;
      }
    }
    if (Object.keys(erros).length) throw R.erro(422, { codigo: "valor_invalido", erros });

    const agora = amb.agora();
    const atuais = R.valoresDoAtendimento(tx, id);
    for (const [nome, valor] of Object.entries(normalizados)) {
      const chave = { id_atendimento: id, id_campo: campos.get(nome).id };
      const existente = tx.obter("CampoValor", chave);
      if (existente) {
        tx.atualizar("CampoValor", chave, { valor, atualizado_em: agora,
          atualizado_por: usuario.email });
      } else {
        tx.inserir("CampoValor", { ...chave, valor, atualizado_em: agora,
          atualizado_por: usuario.email });
      }
      const antes = Object.prototype.hasOwnProperty.call(atuais, nome) ? atuais[nome] : null;
      if (antes !== valor) R.auditar(ctx, "ALTERAR", "CampoValor", id, nome, antes, valor);
    }
    tx.atualizar("Atendimento", id, { versao: at.versao + 1, atualizado_em: agora,
      atualizado_por: usuario.email });
    return { status: 200, corpo: R.ficha(tx, R.obterAtendimento(tx, id)) };
  }

  R.ROTAS.push(
    { m: "GET", r: /^\/api\/atendimentos\/([^/]+)\/ficha$/, perfis: CLINICOS, grava: true,
      h: verFicha },
    { m: "PUT", r: /^\/api\/atendimentos\/([^/]+)\/valores$/, perfis: CLINICOS, grava: true,
      h: salvarValores },
  );
})(RoniVet);
