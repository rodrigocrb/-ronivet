/* Cadastro de tutores e animais. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};
RoniVet.ROTAS = RoniVet.ROTAS || [];

(function (R) {
  "use strict";

  const V = R.validar;
  const { ESCREVEM, EDITAM_ANIMAL } = R.GRUPOS;
  const SEXOS = ["MACHO", "FEMEA", "INDEFINIDO"];

  const porNome = (a, b) => (a.nome < b.nome ? -1 : (a.nome > b.nome ? 1 : 0));
  const TELEFONE_PLANO = (t) => String(t || "").replace(/[ ()+-]/g, "");

  R.tutorDict = (t) => ({
    id: t.id_tutor, nome: t.nome, telefone: t.telefone, cpf: t.cpf, email: t.email,
    endereco: t.endereco, aceita_contato: t.aceita_contato,
    ciencia_finalidade_em: t.ciencia_finalidade_em, consentimento_em: t.consentimento_em,
    consentimento_por: t.consentimento_por,
  });

  R.animalDict = (a) => ({
    id: a.id_animal, id_tutor: a.id_tutor, nome: a.nome, especie: a.especie, sexo: a.sexo,
    raca: a.raca, data_nascimento: a.data_nascimento, pelagem: a.pelagem,
  });

  R.animaisDoTutor = (tx, idTutor) => tx
    .onde("Animal", (a) => a.id_tutor === idTutor && a.ativo === "SIM")
    .sort(porNome).map(R.animalDict);

  R.tutorCompleto = (tx, t) => ({ ...R.tutorDict(t), animais: R.animaisDoTutor(tx, t.id_tutor) });

  R.buscarTutor = (tx, idTutor) => {
    const t = tx.obter("Tutor", idTutor);
    if (!t || t.ativo !== "SIM") throw R.erro(404, "tutor não encontrado");
    return t;
  };

  /** Id do tutor ativo que já usa o CPF (normalizado), se houver. */
  R.cpfEmUso = (tx, cpf, ignorar) => {
    const achado = tx.todos("Tutor")
      .find((t) => t.cpf === cpf && t.ativo === "SIM" && t.id_tutor !== (ignorar || ""));
    return achado ? achado.id_tutor : null;
  };

  R.erroCpfDuplicado = (idExistente) => R.erro(409, {
    codigo: "cpf_duplicado", mensagem: "Já existe um tutor com este CPF.", id_existente: idExistente,
  });

  function criarTutor(ctx) {
    const { tx, usuario, amb } = ctx;
    const c = V.objeto(ctx.req.corpo);
    const nome = V.preenchido(c, "nome");
    const telefone = V.preenchido(c, "telefone");
    const cpf = V.cpfOpcional(V.textoOpcional(c, "cpf"));
    const email = V.textoOpcional(c, "email") ?? null;
    const endereco = V.textoOpcional(c, "endereco") ?? null;
    const id = V.textoOpcional(c, "id") || amb.novoId();

    const existente = tx.obter("Tutor", id);
    if (existente) return { status: 201, corpo: R.tutorCompleto(tx, existente) };  // reenvio
    if (cpf) {
      const dono = R.cpfEmUso(tx, cpf);
      if (dono) throw R.erroCpfDuplicado(dono);
    }
    const agora = amb.agora();
    tx.inserir("Tutor", { id_tutor: id, nome, telefone, cpf, email, endereco,
      criado_em: agora, criado_por: usuario.email, atualizado_em: agora,
      atualizado_por: usuario.email });
    R.auditar(ctx, "CRIAR", "Tutor", id);
    return { status: 201, corpo: R.tutorCompleto(tx, R.buscarTutor(tx, id)) };
  }

  function buscarTutores(ctx) {
    const { tx, req } = ctx;
    const cpf = req.query.cpf;
    if (cpf !== undefined && cpf.trim()) {
      // Só CPF completo e válido: fragmentos não listam tutores.
      if (!R.cpf.valido(cpf)) throw R.erro(422, "CPF inválido");
      const numero = R.cpf.normalizar(cpf);
      const achados = tx.onde("Tutor", (t) => t.cpf === numero && t.ativo === "SIM");
      R.auditar(ctx, "CONSULTAR", "Tutor", null, "cpf", null, R.cpf.mascarar(numero));
      return { status: 200, corpo: achados.map((t) => R.tutorCompleto(tx, t)) };
    }
    const termo = (req.query.q || "").trim();
    let linhas = tx.onde("Tutor", (t) => t.ativo === "SIM");
    if (termo) {
      const norm = R.normalizar(termo);
      const digitos = R.apenasDigitos(termo);
      linhas = linhas.filter((t) => R.normalizar(t.nome).includes(norm)
        || (digitos && TELEFONE_PLANO(t.telefone).includes(digitos)));
    }
    linhas.sort(porNome);
    return { status: 200, corpo: linhas.slice(0, 50).map((t) => R.tutorCompleto(tx, t)) };
  }

  const buscaComCpf = (req) => !!(req.query.cpf && req.query.cpf.trim());

  function obterTutor(ctx) {
    const tutor = R.buscarTutor(ctx.tx, ctx.req.params[0]);
    R.auditar(ctx, "CONSULTAR", "Tutor", ctx.req.params[0]);
    return { status: 200, corpo: R.tutorCompleto(ctx.tx, tutor) };
  }

  /** Aplica `mudancas` (campo -> novo) a uma linha, auditando cada diferença. */
  function aplicarMudancas(ctx, tabela, chave, atual, entidade, idEntidade, mudancas, mascarar) {
    for (const [campo, novo] of Object.entries(mudancas)) {
      const antigo = atual[campo];
      if (antigo === novo) continue;
      ctx.tx.atualizar(tabela, chave, { [campo]: novo });
      if (mascarar && campo === "cpf") {  // a trilha não guarda o número completo
        R.auditar(ctx, "ALTERAR", entidade, idEntidade, campo,
          antigo ? R.cpf.mascarar(antigo) : null, novo ? R.cpf.mascarar(novo) : null);
      } else {
        R.auditar(ctx, "ALTERAR", entidade, idEntidade, campo, antigo, novo);
      }
    }
  }

  function atualizarTutor(ctx) {
    const { tx, usuario, amb } = ctx;
    const id = ctx.req.params[0];
    const atual = R.buscarTutor(tx, id);
    const c = V.objeto(ctx.req.corpo);
    const mudancas = {};
    for (const campo of ["nome", "telefone"]) {
      if (V.tem(c, campo) && c[campo] !== null) mudancas[campo] = V.preenchido(c, campo);
      else if (V.tem(c, campo)) mudancas[campo] = null;
    }
    if (V.tem(c, "cpf")) mudancas.cpf = V.cpfOpcional(V.textoOpcional(c, "cpf"));
    for (const campo of ["email", "endereco"]) {
      if (V.tem(c, campo)) mudancas[campo] = V.textoOpcional(c, campo);
    }
    // nome e telefone nulos explícitos são ignorados (campo obrigatório no banco)
    for (const campo of ["nome", "telefone"]) {
      if (campo in mudancas && mudancas[campo] === null) delete mudancas[campo];
    }
    if (mudancas.cpf) {
      const dono = R.cpfEmUso(tx, mudancas.cpf, id);
      if (dono) throw R.erroCpfDuplicado(dono);
    }
    aplicarMudancas(ctx, "Tutor", id, atual, "Tutor", id, mudancas, true);
    if (V.tem(c, "nome") || V.tem(c, "telefone") || V.tem(c, "cpf") || V.tem(c, "email")
      || V.tem(c, "endereco")) {
      tx.atualizar("Tutor", id, { atualizado_em: amb.agora(), atualizado_por: usuario.email });
    }
    return { status: 200, corpo: R.tutorCompleto(tx, R.buscarTutor(tx, id)) };
  }

  function criarAnimal(ctx) {
    const { tx, usuario, amb } = ctx;
    const c = V.objeto(ctx.req.corpo);
    const idTutor = V.textoObrigatorio(c, "id_tutor");
    const nome = V.preenchido(c, "nome");
    const especie = V.preenchido(c, "especie");
    let sexo = V.textoOpcional(c, "sexo");
    sexo = sexo ? V.opcao(sexo, "sexo", SEXOS) : "INDEFINIDO";
    const id = V.textoOpcional(c, "id") || amb.novoId();
    const confirmar = V.boolOpcional(c, "confirmar_duplicidade", false);

    R.buscarTutor(tx, idTutor);
    const existente = tx.obter("Animal", id);
    if (existente) return { status: 201, corpo: R.animalDict(existente) };  // reenvio
    const duplicado = tx.todos("Animal").find((a) => a.id_tutor === idTutor && a.ativo === "SIM"
      && a.nome.toLowerCase() === nome.toLowerCase()
      && a.especie.toLowerCase() === especie.toLowerCase());
    if (duplicado && !confirmar) {
      throw R.erro(409, { codigo: "possivel_duplicidade",
        mensagem: "Já existe um animal com este nome e espécie para o tutor.",
        id_existente: duplicado.id_animal });
    }
    const agora = amb.agora();
    tx.inserir("Animal", { id_animal: id, id_tutor: idTutor, nome, especie, sexo,
      raca: V.textoOpcional(c, "raca") ?? null,
      data_nascimento: V.textoOpcional(c, "data_nascimento") ?? null,
      pelagem: V.textoOpcional(c, "pelagem") ?? null,
      criado_em: agora, criado_por: usuario.email, atualizado_em: agora,
      atualizado_por: usuario.email });
    R.auditar(ctx, "CRIAR", "Animal", id);
    return { status: 201, corpo: R.animalDict(tx.obter("Animal", id)) };
  }

  function obterAnimal(ctx) {
    const a = ctx.tx.obter("Animal", ctx.req.params[0]);
    if (!a || a.ativo !== "SIM") throw R.erro(404, "animal não encontrado");
    const tutor = R.buscarTutor(ctx.tx, a.id_tutor);
    return { status: 200, corpo: { ...R.animalDict(a), tutor: R.tutorDict(tutor) } };
  }

  function atualizarAnimal(ctx) {
    const { tx, usuario, amb } = ctx;
    const id = ctx.req.params[0];
    const atual = tx.obter("Animal", id);
    if (!atual || atual.ativo !== "SIM") throw R.erro(404, "animal não encontrado");
    const c = V.objeto(ctx.req.corpo);
    const mudancas = {};
    for (const campo of ["nome", "especie"]) {
      if (V.tem(c, campo) && c[campo] !== null) mudancas[campo] = V.preenchido(c, campo);
    }
    if (V.tem(c, "sexo")) {
      const s = V.textoOpcional(c, "sexo");
      mudancas.sexo = s ? V.opcao(s, "sexo", SEXOS) : "INDEFINIDO";
    }
    for (const campo of ["raca", "data_nascimento", "pelagem"]) {
      if (V.tem(c, campo)) mudancas[campo] = V.textoOpcional(c, campo);
    }
    aplicarMudancas(ctx, "Animal", id, atual, "Animal", id, mudancas, false);
    if (Object.keys(mudancas).length || ["nome", "especie", "sexo", "raca", "data_nascimento",
      "pelagem"].some((k) => V.tem(c, k))) {
      tx.atualizar("Animal", id, { atualizado_em: amb.agora(), atualizado_por: usuario.email });
    }
    return { status: 200, corpo: R.animalDict(tx.obter("Animal", id)) };
  }

  function registrarConsentimento(ctx) {
    const { tx, usuario, amb } = ctx;
    const id = ctx.req.params[0];
    const c = V.objeto(ctx.req.corpo);
    const ciencia = V.boolObrigatorio(c, "ciencia_finalidade");
    const aceita = V.boolObrigatorio(c, "aceita_contato");
    const atual = R.buscarTutor(tx, id);
    const agora = amb.agora();
    const novoAceite = aceita ? "SIM" : "NAO";
    const cienciaEm = ciencia ? (atual.ciencia_finalidade_em || agora) : null;
    if (novoAceite !== atual.aceita_contato || atual.consentimento_em === null) {
      tx.atualizar("Tutor", id, { aceita_contato: novoAceite, consentimento_em: agora,
        consentimento_por: usuario.email });
      R.auditar(ctx, "ALTERAR", "Tutor", id, "aceita_contato", atual.aceita_contato, novoAceite);
    }
    if (cienciaEm !== atual.ciencia_finalidade_em) {
      tx.atualizar("Tutor", id, { ciencia_finalidade_em: cienciaEm });
      R.auditar(ctx, "ALTERAR", "Tutor", id, "ciencia_finalidade_em",
        atual.ciencia_finalidade_em, cienciaEm);
    }
    tx.atualizar("Tutor", id, { atualizado_em: agora, atualizado_por: usuario.email });
    return { status: 200, corpo: R.tutorCompleto(tx, R.buscarTutor(tx, id)) };
  }

  R.ROTAS.push(
    { m: "POST", r: /^\/api\/tutores$/, perfis: ESCREVEM, grava: true, h: criarTutor },
    { m: "GET", r: /^\/api\/tutores$/, perfis: null, grava: buscaComCpf, h: buscarTutores },
    { m: "GET", r: /^\/api\/tutores\/([^/]+)$/, perfis: null, grava: true, h: obterTutor },
    { m: "PATCH", r: /^\/api\/tutores\/([^/]+)$/, perfis: ESCREVEM, grava: true, h: atualizarTutor },
    { m: "PUT", r: /^\/api\/tutores\/([^/]+)\/consentimento$/, perfis: ESCREVEM, grava: true,
      h: registrarConsentimento },
    { m: "POST", r: /^\/api\/animais$/, perfis: ESCREVEM, grava: true, h: criarAnimal },
    { m: "GET", r: /^\/api\/animais\/([^/]+)$/, perfis: null, grava: false, h: obterAnimal },
    { m: "PATCH", r: /^\/api\/animais\/([^/]+)$/, perfis: EDITAM_ANIMAL, grava: true,
      h: atualizarAnimal },
  );
})(RoniVet);
