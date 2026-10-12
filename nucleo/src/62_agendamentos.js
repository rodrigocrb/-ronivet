/* Agendamento em uma única ação: cria o tutor e o animal
 * que ainda não existam e o atendimento; ou tudo é criado, ou nada é criado. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};
RoniVet.ROTAS = RoniVet.ROTAS || [];

(function (R) {
  "use strict";

  const V = R.validar;
  const T = R.tempo;
  const { ESCREVEM } = R.GRUPOS;
  const SEXOS = ["MACHO", "FEMEA", "INDEFINIDO"];

  const faltando = (campos) => R.erro(422, {
    codigo: "campos_faltando", campos, mensagem: `Informe: ${campos.join(", ")}.`,
  });

  function resposta(tx, idAtendimento, extra) {
    const at = tx.obter("Atendimento", idAtendimento);
    const animal = tx.obter("Animal", at.id_animal);
    const tutor = tx.obter("Tutor", animal.id_tutor);
    return { atendimento: R.atendimentoDict(tx, at), tutor: R.tutorCompleto(tx, tutor),
      animal: R.animalDict(animal), ...(extra || {}) };
  }

  /** Corrige dados do tutor selecionado (somente o que foi enviado e difere). */
  function atualizarTutor(ctx, atual, ref) {
    const { tx, usuario, amb } = ctx;
    const novos = { nome: R.txt(ref.nome), telefone: R.txt(ref.telefone),
      email: R.txt(ref.email), endereco: R.txt(ref.endereco) };
    if (R.txt(ref.cpf)) novos.cpf = R.cpf.normalizar(ref.cpf);
    let alterou = false;
    for (const [campo, novo] of Object.entries(novos)) {
      if (novo === null || novo === atual[campo]) continue;
      if (campo === "cpf") {
        const dono = R.cpfEmUso(tx, novo, atual.id_tutor);
        if (dono) throw R.erroCpfDuplicado(dono);
      }
      tx.atualizar("Tutor", atual.id_tutor, { [campo]: novo });
      if (campo === "cpf") {   // a trilha não guarda o número completo
        R.auditar(ctx, "ALTERAR", "Tutor", atual.id_tutor, campo,
          atual[campo] ? R.cpf.mascarar(atual[campo]) : null, R.cpf.mascarar(novo));
      } else {
        R.auditar(ctx, "ALTERAR", "Tutor", atual.id_tutor, campo, atual[campo], novo);
      }
      alterou = true;
    }
    if (alterou) {
      tx.atualizar("Tutor", atual.id_tutor, { atualizado_em: amb.agora(),
        atualizado_por: usuario.email });
    }
  }

  /** Autorização de contato no agendamento: marcada registra, desmarcada revoga. */
  function registrarConsentimento(ctx, idTutor, aceita) {
    const { tx, usuario, amb } = ctx;
    const atual = tx.obter("Tutor", idTutor);
    const novo = aceita ? "SIM" : "NAO";
    if (atual.aceita_contato === novo) return;
    const agora = amb.agora();
    tx.atualizar("Tutor", idTutor, {
      aceita_contato: novo, consentimento_em: agora, consentimento_por: usuario.email,
      ciencia_finalidade_em: novo === "SIM" ? (atual.ciencia_finalidade_em || agora)
        : atual.ciencia_finalidade_em,
      atualizado_em: agora, atualizado_por: usuario.email,
    });
    R.auditar(ctx, "ALTERAR", "Tutor", idTutor, "aceita_contato", atual.aceita_contato, novo);
  }

  function agendarCompleto(ctx) {
    const { tx, usuario, amb } = ctx;
    const c = V.objeto(ctx.req.corpo);
    const t = V.objeto(c.tutor);
    const a = V.objeto(c.animal);
    const dados = {
      id: V.textoOpcional(c, "id") || null,
      inicio: V.textoOpcional(c, "inicio") ?? null,
      id_tipo: V.textoOpcional(c, "id_tipo") ?? null,
      duracao_min: V.inteiroOpcional(c, "duracao_min"),
    };
    const idAtendimento = dados.id || amb.novoId();

    // Reenvio da mesma operação: devolve o que já foi criado.
    if (tx.obter("Atendimento", idAtendimento)) {
      return { status: 201, corpo: resposta(tx, idAtendimento) };
    }

    const faltam = [];
    if (!R.txt(dados.inicio)) faltam.push("inicio");
    if (!R.txt(dados.id_tipo)) faltam.push("id_tipo");

    // --- tutor: por id, depois por CPF; senão será criado ---
    let cpfNorm = null;
    if (R.txt(t.cpf)) {
      if (!R.cpf.valido(t.cpf)) {
        throw R.erro(422, { codigo: "cpf_invalido", mensagem: "CPF inválido." });
      }
      cpfNorm = R.cpf.normalizar(t.cpf);
    }
    let tutorRow = null;
    let reutilizadoPorCpf = false;
    let idTutorNovo = null;   // id gerado pelo aparelho (operação feita offline)
    if (R.txt(t.id)) {
      const achado = tx.obter("Tutor", t.id);
      if (achado && achado.ativo === "SIM") tutorRow = achado;
      else if (!achado && R.txt(t.nome) && R.txt(t.telefone)) idTutorNovo = t.id;
      else throw R.erro(404, "tutor não encontrado");
    }
    if (!tutorRow && cpfNorm) {
      tutorRow = tx.todos("Tutor").find((x) => x.cpf === cpfNorm && x.ativo === "SIM") || null;
      reutilizadoPorCpf = !!tutorRow;
    }
    if (!tutorRow) {
      if (!R.txt(t.nome)) faltam.push("tutor.nome");
      if (!R.txt(t.telefone)) faltam.push("tutor.telefone");
    }

    // --- animal: por id (do tutor), depois por nome + espécie; senão será criado ---
    let animalRow = null;
    let idAnimalNovo = null;
    if (R.txt(a.id)) {
      const achado = tx.obter("Animal", a.id);
      if (achado) {
        if (achado.ativo !== "SIM") throw R.erro(404, "animal não encontrado");
        if (!tutorRow || achado.id_tutor !== tutorRow.id_tutor) {
          throw R.erro(422, { codigo: "animal_de_outro_tutor",
            mensagem: "O animal não pertence ao tutor." });
        }
        animalRow = achado;
      } else if (R.txt(a.nome) && R.txt(a.especie)) {
        idAnimalNovo = a.id;
      } else {
        throw R.erro(404, "animal não encontrado");
      }
    }
    if (!animalRow && tutorRow && R.txt(a.nome) && R.txt(a.especie)) {
      const nomeN = R.normalizar(a.nome.trim());
      const especieN = R.normalizar(a.especie.trim());
      animalRow = tx.todos("Animal").find((x) => x.id_tutor === tutorRow.id_tutor
        && x.ativo === "SIM" && R.normalizar(x.nome) === nomeN
        && R.normalizar(x.especie) === especieN) || null;
    }
    if (!animalRow) {
      if (!R.txt(a.nome)) faltam.push("animal.nome");
      if (!R.txt(a.especie)) faltam.push("animal.especie");
    }
    if (a.sexo !== undefined && a.sexo !== null && !SEXOS.includes(a.sexo)) {
      throw R.erro(422, { codigo: "sexo_invalido", mensagem: "Sexo inválido." });
    }
    if (faltam.length) throw faltando(faltam);

    const tipo = dados.id_tipo ? tx.obter("TipoAtendimento", dados.id_tipo) : null;
    if (!tipo || tipo.ativo !== "SIM") throw R.erro(404, "tipo de atendimento não encontrado");
    const inicio = T.parseInicio(dados.inicio);
    const duracao = dados.duracao_min && dados.duracao_min > 0 ? dados.duracao_min
      : tipo.duracao_min;
    // O horário é validado antes de criar qualquer coisa.
    R.validarHorario(tx, inicio, duracao);

    const agora = amb.agora();
    const email = usuario.email;
    let idTutor;
    if (!tutorRow) {
      if (cpfNorm) {   // corrida: surgiu agora
        const dono = R.cpfEmUso(tx, cpfNorm);
        if (dono) throw R.erroCpfDuplicado(dono);
      }
      idTutor = idTutorNovo || amb.novoId();
      tx.inserir("Tutor", { id_tutor: idTutor, nome: R.txt(t.nome), telefone: R.txt(t.telefone),
        cpf: cpfNorm, email: R.txt(t.email), endereco: R.txt(t.endereco), criado_em: agora,
        criado_por: email, atualizado_em: agora, atualizado_por: email });
      R.auditar(ctx, "CRIAR", "Tutor", idTutor);
    } else {
      idTutor = tutorRow.id_tutor;
      // Reutilizado só pelo CPF: não sobrescreve nome/telefone de quem foi apenas encontrado
      // pelo documento (evita corromper o cadastro por um CPF digitado errado).
      if (!reutilizadoPorCpf) atualizarTutor(ctx, tutorRow, t);
    }
    if (t.aceita_contato !== undefined && t.aceita_contato !== null) {
      registrarConsentimento(ctx, idTutor, !!t.aceita_contato);
    }

    let idAnimal;
    if (!animalRow) {
      idAnimal = idAnimalNovo || amb.novoId();
      tx.inserir("Animal", { id_animal: idAnimal, id_tutor: idTutor, nome: R.txt(a.nome),
        especie: R.txt(a.especie), sexo: a.sexo || "INDEFINIDO", raca: R.txt(a.raca),
        data_nascimento: R.txt(a.data_nascimento), pelagem: R.txt(a.pelagem), criado_em: agora,
        criado_por: email, atualizado_em: agora, atualizado_por: email });
      R.auditar(ctx, "CRIAR", "Animal", idAnimal);
    } else {
      idAnimal = animalRow.id_animal;
    }

    tx.inserir("Atendimento", { id_atendimento: idAtendimento, id_animal: idAnimal,
      id_tipo: dados.id_tipo, inicio, duracao_min: duracao, status: "AGENDADO", versao: 1,
      criado_em: agora, criado_por: email, atualizado_em: agora, atualizado_por: email });
    R.auditar(ctx, "CRIAR", "Atendimento", idAtendimento);
    return { status: 201, corpo: resposta(tx, idAtendimento, {
      tutor_reutilizado: !!tutorRow, animal_reutilizado: !!animalRow }) };
  }

  R.ROTAS.push(
    { m: "POST", r: /^\/api\/agendamentos$/, perfis: ESCREVEM, grava: true, h: agendarCompleto },
  );
})(RoniVet);
