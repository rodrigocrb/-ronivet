/* Tipos de atendimento e seus campos configuráveis. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};
RoniVet.ROTAS = RoniVet.ROTAS || [];

(function (R) {
  "use strict";

  const V = R.validar;
  const NOME_CAMPO = /^[a-z][a-z0-9_]*$/;
  const PREFIXOS_RESERVADOS = ["tutor_", "animal_", "atendimento_", "veterinario_"];
  const TIPOS_DADO = ["TEXTO", "NUMERO", "DATA", "LISTA", "SIMNAO"];
  const PAPEIS = ["VACINA_PRODUTO", "VACINA_LOTE", "VACINA_DATA", "VACINA_PROXIMA_DOSE"];

  function validarNomeCampo(nome) {
    if (!NOME_CAMPO.test(nome)) {
      throw V.invalido("nome", "nome do campo: minúsculas, números e _, começando por letra");
    }
    if (PREFIXOS_RESERVADOS.some((p) => nome.startsWith(p))) {
      throw V.invalido("nome", "nome do campo usa prefixo reservado");
    }
    return nome;
  }

  const opcoesDe = (texto) => (texto ? texto.split("|") : []);

  R.campoDict = (c) => ({
    id: c.id_campo, id_tipo: c.id_tipo, nome: c.nome, rotulo: c.rotulo, tipo_dado: c.tipo_dado,
    opcoes: opcoesDe(c.opcoes), obrigatorio: c.obrigatorio === "SIM", ordem: c.ordem,
    papel: c.papel, ativo: c.ativo,
  });

  /** Campos do tipo ordenados por (ordem, nome). */
  R.camposDoTipo = (tx, idTipo, somenteAtivos = true) => tx
    .onde("CampoDef", (c) => c.id_tipo === idTipo && (!somenteAtivos || c.ativo === "SIM"))
    .sort((a, b) => (a.ordem - b.ordem) || (a.nome < b.nome ? -1 : (a.nome > b.nome ? 1 : 0)))
    .map(R.campoDict);

  R.tipoDict = (tx, t) => ({
    id: t.id_tipo, nome: t.nome, duracao_min: t.duracao_min, ativo: t.ativo,
    arquivo_template: t.arquivo_template, campos: R.camposDoTipo(tx, t.id_tipo),
  });

  const obterTipo = (tx, id) => {
    const t = tx.obter("TipoAtendimento", id);
    if (!t) throw R.erro(404, "tipo de atendimento não encontrado");
    return t;
  };

  function listarTipos(ctx) {
    const incluir = ["true", "1", "True"].includes(ctx.req.query.incluir_inativos);
    const linhas = ctx.tx.onde("TipoAtendimento", (t) => incluir || t.ativo === "SIM")
      .sort((a, b) => (a.nome < b.nome ? -1 : (a.nome > b.nome ? 1 : 0)));
    return { status: 200, corpo: linhas.map((t) => R.tipoDict(ctx.tx, t)) };
  }

  function criarTipo(ctx) {
    const { tx, amb } = ctx;
    const c = V.objeto(ctx.req.corpo);
    const nome = V.preenchido(c, "nome");
    const duracao = V.tem(c, "duracao_min") ? V.inteiroObrigatorio(c, "duracao_min") : 30;
    if (duracao <= 0) throw V.invalido("duracao_min", "duração deve ser positiva");
    const id = V.textoOpcional(c, "id") || amb.novoId();
    const existente = tx.obter("TipoAtendimento", id);
    if (existente) return { status: 201, corpo: R.tipoDict(tx, existente) };
    const agora = amb.agora();
    tx.inserir("TipoAtendimento", { id_tipo: id, nome, duracao_min: duracao, criado_em: agora,
      atualizado_em: agora });
    R.auditar(ctx, "CRIAR", "TipoAtendimento", id);
    return { status: 201, corpo: R.tipoDict(tx, obterTipo(tx, id)) };
  }

  function atualizarTipo(ctx) {
    const { tx, amb } = ctx;
    const id = ctx.req.params[0];
    const atual = obterTipo(tx, id);
    const c = V.objeto(ctx.req.corpo);
    const mudancas = {};
    if (V.tem(c, "nome")) mudancas.nome = V.textoOpcional(c, "nome");
    if (V.tem(c, "duracao_min")) mudancas.duracao_min = V.inteiroOpcional(c, "duracao_min");
    if (V.tem(c, "ativo")) {
      const a = V.textoOpcional(c, "ativo");
      if (a !== null) V.opcao(a, "ativo", ["SIM", "NAO"]);
      mudancas.ativo = a;
    }
    if ("duracao_min" in mudancas && (mudancas.duracao_min || 0) <= 0) {
      throw R.erro(422, "duração deve ser positiva");
    }
    if ("nome" in mudancas && !(mudancas.nome || "").trim()) throw R.erro(422, "nome obrigatório");
    for (const [campo, novo] of Object.entries(mudancas)) {
      if (atual[campo] !== novo) {
        tx.atualizar("TipoAtendimento", id, { [campo]: novo });
        R.auditar(ctx, "ALTERAR", "TipoAtendimento", id, campo, atual[campo], novo);
      }
    }
    if (Object.keys(mudancas).length) tx.atualizar("TipoAtendimento", id, { atualizado_em: amb.agora() });
    return { status: 200, corpo: R.tipoDict(tx, obterTipo(tx, id)) };
  }

  function criarCampo(ctx) {
    const { tx, amb } = ctx;
    const idTipo = ctx.req.params[0];
    obterTipo(tx, idTipo);
    const c = V.objeto(ctx.req.corpo);
    const nome = validarNomeCampo(V.textoObrigatorio(c, "nome"));
    const rotulo = V.preenchido(c, "rotulo");
    const tipoDado = V.tem(c, "tipo_dado") ? V.opcao(c.tipo_dado, "tipo_dado", TIPOS_DADO) : "TEXTO";
    let opcoes = null;
    if (V.tem(c, "opcoes") && c.opcoes !== null) {
      if (!Array.isArray(c.opcoes) || c.opcoes.some((o) => typeof o !== "string")) {
        throw V.invalido("opcoes", "Input should be a valid list");
      }
      opcoes = c.opcoes;
    }
    const papel = V.tem(c, "papel") && c.papel !== null ? V.opcao(c.papel, "papel", PAPEIS) : null;
    if (tipoDado === "LISTA" && !(opcoes && opcoes.length)) {
      throw R.erro(422, "campo do tipo LISTA exige opções");
    }
    if (opcoes && opcoes.some((o) => o.includes("|"))) {
      throw R.erro(422, "opções não podem conter '|'");
    }
    const id = V.textoOpcional(c, "id") || amb.novoId();
    const existente = tx.obter("CampoDef", id);
    if (existente) return { status: 201, corpo: R.campoDict(existente) };
    if (tx.todos("CampoDef").some((x) => x.id_tipo === idTipo && x.nome === nome)) {
      throw R.erro(409, { codigo: "campo_duplicado", mensagem: "Já existe um campo com este nome." });
    }
    let ordem = V.inteiroOpcional(c, "ordem");
    if (ordem === null) {
      ordem = tx.todos("CampoDef").filter((x) => x.id_tipo === idTipo)
        .reduce((m, x) => Math.max(m, Number(x.ordem) || 0), 0) + 1;
    }
    tx.inserir("CampoDef", { id_campo: id, id_tipo: idTipo, nome, rotulo, tipo_dado: tipoDado,
      opcoes: opcoes && opcoes.length ? opcoes.join("|") : null,
      obrigatorio: V.boolOpcional(c, "obrigatorio", false) ? "SIM" : "NAO", ordem, papel });
    R.auditar(ctx, "CRIAR", "CampoDef", id);
    return { status: 201, corpo: R.campoDict(tx.obter("CampoDef", id)) };
  }

  function atualizarCampo(ctx) {
    const { tx } = ctx;
    const id = ctx.req.params[0];
    const atual = tx.obter("CampoDef", id);
    if (!atual) throw R.erro(404, "campo não encontrado");
    const c = V.objeto(ctx.req.corpo);
    const novos = {};
    if (V.tem(c, "rotulo")) {
      const r = V.textoOpcional(c, "rotulo");
      if (!(r || "").trim()) throw R.erro(422, "rótulo obrigatório");
      novos.rotulo = r.trim();
    }
    if (V.tem(c, "opcoes")) {
      novos.opcoes = Array.isArray(c.opcoes) && c.opcoes.length ? c.opcoes.join("|") : null;
    }
    if (V.tem(c, "obrigatorio")) novos.obrigatorio = c.obrigatorio ? "SIM" : "NAO";
    if (V.tem(c, "ordem")) novos.ordem = V.inteiroOpcional(c, "ordem");
    if (V.tem(c, "ativo")) novos.ativo = V.opcao(c.ativo, "ativo", ["SIM", "NAO"]);
    for (const [campo, novo] of Object.entries(novos)) {
      if (atual[campo] !== novo) {
        tx.atualizar("CampoDef", id, { [campo]: novo });
        R.auditar(ctx, "ALTERAR", "CampoDef", id, campo, atual[campo], novo);
      }
    }
    return { status: 200, corpo: R.campoDict(tx.obter("CampoDef", id)) };
  }

  R.ROTAS.push(
    { m: "GET", r: /^\/api\/tipos$/, perfis: null, grava: false, h: listarTipos },
    { m: "POST", r: /^\/api\/tipos$/, perfis: ["ADMIN"], grava: true, h: criarTipo },
    { m: "PATCH", r: /^\/api\/tipos\/([^/]+)$/, perfis: ["ADMIN"], grava: true, h: atualizarTipo },
    { m: "POST", r: /^\/api\/tipos\/([^/]+)\/campos$/, perfis: ["ADMIN"], grava: true,
      h: criarCampo },
    { m: "PATCH", r: /^\/api\/campos\/([^/]+)$/, perfis: ["ADMIN"], grava: true,
      h: atualizarCampo },
  );
})(RoniVet);
