/* Encerramento, documento, verificação, aditamentos e modelo do tipo. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};
RoniVet.ROTAS = RoniVet.ROTAS || [];

(function (R) {
  "use strict";

  const V = R.validar;
  const { CLINICOS } = R.GRUPOS;
  const SEXO = { MACHO: "Macho", FEMEA: "Fêmea", INDEFINIDO: "Indefinido" };

  /** Marcadores fornecidos pelo sistema (tutor, animal, atendimento, veterinário). */
  const MARCADORES_RESERVADOS = [
    "tutor_nome", "tutor_telefone", "tutor_cpf", "tutor_email", "tutor_endereco",
    "animal_nome", "animal_especie", "animal_sexo", "animal_raca", "animal_data_nascimento",
    "animal_pelagem", "atendimento_id", "atendimento_tipo", "atendimento_data",
    "atendimento_hora", "atendimento_encerrado_em", "veterinario_nome", "veterinario_crmv",
  ];

  /** Falha ao gerar o documento: o atendimento permanece aberto. */
  class FalhaDocumento extends Error {}

  const novoMarcador = () => /\{([a-z][a-z0-9_]*)\}/g;

  function marcadoresDoTexto(texto) {
    const achados = new Set();
    for (const m of String(texto).matchAll(novoMarcador())) achados.add(m[1]);
    return achados;
  }

  /** Substitui {marcadores}; marcador sem valor lança FalhaDocumento. O `$` dos valores é literal. */
  function preencherTexto(texto, valores) {
    const faltam = new Set();
    const saida = String(texto).replace(novoMarcador(), (todo, nome) => {
      if (Object.prototype.hasOwnProperty.call(valores, nome)) return String(valores[nome]);
      faltam.add(nome);
      return todo;
    });
    if (faltam.size) {
      throw new FalhaDocumento(`marcadores sem valor: ${[...faltam].sort().join(", ")}`);
    }
    return saida;
  }

  /** Texto do modelo padrão (quando o tipo não tem modelo): dados fixos + uma linha por campo. */
  function textoModeloPadrao(titulo, campos) {
    return [
      titulo,
      "Tutor: {tutor_nome}  ·  Telefone: {tutor_telefone}",
      "Animal: {animal_nome}  ·  Espécie: {animal_especie}  ·  Sexo: {animal_sexo}",
      "Atendimento: {atendimento_tipo}  ·  Data: {atendimento_data} {atendimento_hora}",
      "",
      ...campos.map((c) => `${c.rotulo}: {${c.nome}}`),
      "",
      "Veterinário(a): {veterinario_nome}  ·  CRMV: {veterinario_crmv}",
    ].join("\n");
  }

  R.documentos = { MARCADORES_RESERVADOS, FalhaDocumento, marcadoresDoTexto, preencherTexto,
    textoModeloPadrao };

  // ---------- formatação ----------

  function formatarValor(campo, valor) {
    if (valor === null || valor === undefined || valor === "") return "—";
    if (campo.tipo_dado === "DATA") return R.tempo.dataBR(valor);
    if (campo.tipo_dado === "SIMNAO") return valor === "SIM" ? "Sim" : "Não";
    return valor;
  }

  const br = (iso) => ({ data: R.tempo.dataBR(iso.slice(0, 10)), hora: iso.slice(11, 16) });

  function valoresDoDocumento(tx, at, tipo, campos, valores, vet, encerradoEm) {
    const animal = tx.obter("Animal", at.id_animal);
    const tutor = tx.obter("Tutor", animal.id_tutor);
    const ini = br(at.inicio);
    const enc = br(encerradoEm);
    const saida = {
      tutor_nome: tutor.nome, tutor_telefone: tutor.telefone, tutor_cpf: tutor.cpf || "—",
      tutor_email: tutor.email || "—", tutor_endereco: tutor.endereco || "—",
      animal_nome: animal.nome, animal_especie: animal.especie,
      animal_sexo: SEXO[animal.sexo] || animal.sexo, animal_raca: animal.raca || "—",
      animal_data_nascimento: animal.data_nascimento ? R.tempo.dataBR(animal.data_nascimento) : "—",
      animal_pelagem: animal.pelagem || "—",
      atendimento_id: at.id_atendimento, atendimento_tipo: tipo.nome,
      atendimento_data: ini.data, atendimento_hora: ini.hora,
      atendimento_encerrado_em: `${enc.data} ${enc.hora}`,
      veterinario_nome: vet.nome, veterinario_crmv: vet.crmv || "",
    };
    for (const c of campos) saida[c.nome] = formatarValor(c, valores[c.nome]);
    return saida;
  }

  /**
   * Tudo o que o documento precisa, a partir dos dados do atendimento encerrado: título, campos,
   * valores para os marcadores, linhas de identificação e o modelo do tipo. Usado no encerramento
   * (modo antigo) e na geração posterior do PDF (aparelho/Drive).
   */
  R.dadosDoDocumento = function dadosDoDocumento(tx, at) {
    const tipo = tx.obter("TipoAtendimento", at.id_tipo);
    const campos = R.camposDoTipo(tx, at.id_tipo);
    const valores = R.valoresDoAtendimento(tx, at.id_atendimento);
    const vet = tx.obter("Usuario", at.veterinario_email)
      || { nome: at.veterinario_email, crmv: "" };
    const encerradoEm = at.encerrado_em;
    const enc = br(encerradoEm);
    return {
      titulo: tipo.nome, modeloId: tipo.arquivo_template || null,
      campos: campos.map((c) => ({ rotulo: c.rotulo, nome: c.nome })),
      valores: valoresDoDocumento(tx, at, tipo, campos, valores, vet, encerradoEm),
      identificacao: [
        `Atendimento nº ${at.id_atendimento}`,
        `Responsável: ${vet.nome} · CRMV: ${vet.crmv}`,
        `Encerrado em ${enc.data} ${enc.hora}`,
      ],
    };
  };

  // ---------- selo de integridade dos dados ----------

  /** Hash dos dados do atendimento encerrado; detecta alteração direta na planilha. */
  R.seloDoAtendimento = function seloDoAtendimento(amb, at, valores) {
    const ordenados = {};
    for (const k of Object.keys(valores).sort()) ordenados[k] = valores[k];
    return amb.sha256(JSON.stringify({
      id: at.id_atendimento, animal: at.id_animal, tipo: at.id_tipo, inicio: at.inicio,
      duracao: at.duracao_min, veterinario: at.veterinario_email, encerrado_em: at.encerrado_em,
      hash: at.hash_sha256, valores: ordenados,
    }));
  };

  const resumo = (a) => ({
    id: a.id_atendimento, status: a.status, encerrado_em: a.encerrado_em,
    veterinario_email: a.veterinario_email, hash_sha256: a.hash_sha256,
    documento: !!a.arquivo_pdf || a.documento_estado === "GERADO", versao: a.versao,
    documento_estado: a.documento_estado || (a.arquivo_pdf ? "GERADO" : null),
    documento_nome: a.documento_nome || a.arquivo_pdf || null,
  });

  // ---------- encerramento ----------

  /** Veterinário, ou administrador com CRMV cadastrado (quem também atende). */
  function exigirResponsavelTecnico(usuario, o_que) {
    if (usuario.perfil === "VETERINARIO") return;
    if (usuario.perfil === "ADMIN" && String(usuario.crmv || "").trim()) return;
    throw R.erro(403, { codigo: "crmv_necessario",
      mensagem: `Para ${o_que}, cadastre o seu CRMV na configuração de pessoas.` });
  }

  function encerrar(ctx) {
    const { tx, usuario, amb, repo } = ctx;
    exigirResponsavelTecnico(usuario, "encerrar atendimentos");
    const id = ctx.req.params[0];
    const at = R.obterAtendimento(tx, id);
    if (at.status === "ENCERRADO") return { status: 200, corpo: resumo(at) };  // reenvio
    if (at.status === "CANCELADO") {
      throw R.erro(409, { codigo: "atendimento_cancelado", mensagem: "Atendimento cancelado." });
    }
    const tipo = tx.obter("TipoAtendimento", at.id_tipo);
    const campos = R.camposDoTipo(tx, at.id_tipo);
    const valores = R.valoresDoAtendimento(tx, id);
    const faltam = campos.filter((c) => c.obrigatorio && !(valores[c.nome] || "").trim())
      .map((c) => c.rotulo);
    if (faltam.length) {
      throw R.erro(422, { codigo: "campos_obrigatorios",
        mensagem: "Preencha os campos obrigatórios.", campos: faltam });
    }

    const encerradoEm = amb.agora();
    const valoresDoc = valoresDoDocumento(tx, at, tipo, campos, valores, usuario, encerradoEm);
    const enc = br(encerradoEm);
    const identificacao = [
      `Atendimento nº ${id}`,
      `Responsável: ${usuario.nome} · CRMV: ${usuario.crmv}`,
      `Encerrado em ${enc.data} ${enc.hora}`,
    ];
    let conteudo = null;
    const posterior = amb.documentoPosterior === true;
    try {
      if (!posterior) conteudo = amb.documentos.renderizar({
        modeloId: tipo.arquivo_template || null, titulo: tipo.nome,
        campos: campos.map((c) => ({ rotulo: c.rotulo, nome: c.nome })),
        valores: valoresDoc, identificacao,
      });
    } catch (e) {
      const motivo = e instanceof FalhaDocumento ? e.message : `falha ao gerar o PDF: ${e.message}`;
      throw R.erro(500, { codigo: "falha_documento",
        mensagem: "Não foi possível gerar o documento. O atendimento continua aberto.",
        motivo });
    }
    // Modo posterior (aparelho): o PDF é gerado depois, pelo Drive; aqui só se encerra.
    const relativo = posterior ? null : `${encerradoEm.slice(0, 4)}/${id}.pdf`;
    if (!posterior) {
      repo.gravarArquivo(relativo, conteudo);
      tx.registrarCompensacao(() => repo.excluirArquivo(relativo));
    }
    const hash = posterior ? null : amb.sha256(conteudo);

    // Vacina estruturada (campos com "papel").
    const porPapel = {};
    for (const c of campos) if (c.papel) porPapel[c.papel] = c.nome;
    if (Object.keys(porPapel).length) {
      const v = (papel) => {
        const nome = porPapel[papel];
        return nome ? (valores[nome] || null) : null;
      };
      tx.inserir("Vacina", { id_vacina: amb.novoId(), id_animal: at.id_animal, id_atendimento: id,
        produto: v("VACINA_PRODUTO"), lote: v("VACINA_LOTE"),
        data_aplicacao: v("VACINA_DATA") || encerradoEm.slice(0, 10),
        proxima_dose: v("VACINA_PROXIMA_DOSE"), criado_em: encerradoEm });
    }

    const encerrado = { ...at, status: "ENCERRADO", encerrado_em: encerradoEm,
      veterinario_email: usuario.email, arquivo_pdf: relativo, hash_sha256: hash };
    const selo = R.seloDoAtendimento(amb, encerrado, valores);
    tx.atualizar("Atendimento", id, { status: "ENCERRADO", encerrado_em: encerradoEm,
      veterinario_email: usuario.email, arquivo_pdf: relativo, hash_sha256: hash,
      selo_integridade: selo, versao: at.versao + 1, atualizado_em: encerradoEm,
      atualizado_por: usuario.email,
      documento_estado: posterior ? "PENDENTE" : null });
    R.auditar(ctx, "ENCERRAR", "Atendimento", id, "hash_sha256", null, hash);
    return { status: 200, corpo: resumo(tx.obter("Atendimento", id)) };
  }

  function arquivoPdf(ctx, at) {
    if (at.status !== "ENCERRADO" || !at.arquivo_pdf) throw R.erro(404, "documento não disponível");
    const conteudo = ctx.repo.lerArquivo(at.arquivo_pdf);
    if (conteudo === null) throw R.erro(404, "arquivo do documento não encontrado");
    return conteudo;
  }

  /** Documento sem arquivo local: o PDF vive no Drive e é aberto sob demanda pelo aplicativo. */
  function semArquivoLocal(ctx, at) {
    return ctx.amb.documentoPosterior === true && at.status === "ENCERRADO"
      && !(at.arquivo_pdf && ctx.repo.existeArquivo(at.arquivo_pdf));
  }

  function documento(ctx) {
    const at = R.obterAtendimento(ctx.tx, ctx.req.params[0]);
    if (semArquivoLocal(ctx, at)) {
      if (at.documento_estado === "PENDENTE") {
        throw R.erro(409, { codigo: "documento_pendente",
          mensagem: "O documento ainda está sendo gerado." });
      }
      R.auditar(ctx, "CONSULTAR", "Documento", at.id_atendimento);
      return { status: 200, corpo: { tipo_conteudo: "application/pdf", no_drive: true,
        nome_arquivo: `atendimento-${at.id_atendimento}.pdf`, nome: at.documento_nome || at.arquivo_pdf,
        hash_sha256: at.hash_sha256, estado: at.documento_estado || "GERADO" } };
    }
    const conteudo = arquivoPdf(ctx, at);
    R.auditar(ctx, "CONSULTAR", "Documento", at.id_atendimento);
    return { status: 200, corpo: { tipo_conteudo: "application/pdf",
      nome_arquivo: `atendimento-${at.id_atendimento}.pdf`,
      base64: ctx.amb.paraBase64(conteudo) } };
  }

  function verificar(ctx) {
    const at = R.obterAtendimento(ctx.tx, ctx.req.params[0]);
    if (semArquivoLocal(ctx, at)) {   // a conferência do arquivo é feita ao baixá-lo do Drive
      return { status: 200, corpo: { ok: null, no_drive: true, estado: at.documento_estado || "GERADO",
        hash_registrado: at.hash_sha256 } };
    }
    const atual = ctx.amb.sha256(arquivoPdf(ctx, at));
    return { status: 200, corpo: { ok: atual === at.hash_sha256, hash_registrado: at.hash_sha256,
      hash_atual: atual } };
  }

  // ---------- documento gerado depois do encerramento ----------

  /**
   * Registra o PDF gerado no Drive. O primeiro registro vence; depois de anexado, o documento é
   * imutável (um novo anexo devolve o existente, sem alterar nada). O selo passa a cobrir o hash.
   */
  function anexarDocumento(ctx) {
    const { tx, amb } = ctx;
    const id = ctx.req.params[0];
    const at = R.obterAtendimento(tx, id);
    if (at.status !== "ENCERRADO") {
      throw R.erro(409, { codigo: "atendimento_nao_encerrado",
        mensagem: "Só é possível anexar documento a atendimento encerrado." });
    }
    const c = V.objeto(ctx.req.corpo);
    const sha = V.preenchido(c, "sha256").toLowerCase();
    const nome = V.preenchido(c, "nome");
    const modelo = V.textoOpcional(c, "modelo") || "padrao";
    if (!/^[0-9a-f]{64}$/.test(sha)) throw V.invalido("sha256", "hash inválido");
    if (nome.length > 300 || /(^|\/)\.\.(\/|$)/.test(nome) || nome.startsWith("/")) {
      throw V.invalido("nome", "nome de arquivo inválido");
    }
    if (at.documento_estado === "GERADO") {
      return { status: 200, corpo: { ...resumo(at), anexado: false } };
    }
    if (at.hash_sha256 && at.hash_sha256 !== sha) {
      throw R.erro(409, { codigo: "hash_diferente",
        mensagem: "O arquivo não confere com o hash registrado do documento." });
    }
    const agora = amb.agora();
    const valores = R.valoresDoAtendimento(tx, id);
    const novo = { ...at, hash_sha256: sha, documento_estado: "GERADO", documento_nome: nome,
      documento_modelo: modelo, documento_gerado_em: agora };
    tx.atualizar("Atendimento", id, { hash_sha256: sha, documento_estado: "GERADO",
      documento_nome: nome, documento_modelo: modelo, documento_gerado_em: agora,
      selo_integridade: R.seloDoAtendimento(amb, novo, valores) });
    R.auditar(ctx, "ANEXAR", "Documento", id, "hash_sha256", at.hash_sha256 || null, sha);
    return { status: 200, corpo: { ...resumo(tx.obter("Atendimento", id)), anexado: true } };
  }

  /**
   * Nova emissão: o arquivo do documento não está mais no Drive (ou não confere). Volta o
   * documento a "pendente" para ser gerado de novo a partir dos dados. O hash da emissão
   * anterior fica na auditoria (REEMITIR) e o contador de emissões sobe, o que muda o nome do
   * arquivo. Repetida enquanto pendente, não faz nada.
   */
  function reemitirDocumento(ctx) {
    const { tx, amb, repo } = ctx;
    const id = ctx.req.params[0];
    const at = R.obterAtendimento(tx, id);
    if (at.status !== "ENCERRADO") {
      throw R.erro(409, { codigo: "atendimento_nao_encerrado",
        mensagem: "Só é possível emitir nova via de atendimento encerrado." });
    }
    if (at.documento_estado === "PENDENTE") {
      return { status: 200, corpo: { ...resumo(at), reemitido: false } };
    }
    if (at.documento_estado !== "GERADO") {
      throw R.erro(409, { codigo: "documento_nao_gerado",
        mensagem: "Este atendimento não tem documento gerado pelo Drive." });
    }
    if (at.arquivo_pdf && repo.existeArquivo(at.arquivo_pdf)) {
      throw R.erro(409, { codigo: "documento_no_aparelho",
        mensagem: "O arquivo ainda está neste aparelho; ele sobe ao Drive na sincronização." });
    }
    const valores = R.valoresDoAtendimento(tx, id);
    const emissao = (Number(at.documento_emissao) || 1) + 1;
    const novo = { ...at, hash_sha256: null, documento_estado: "PENDENTE", documento_nome: null,
      documento_modelo: null, documento_gerado_em: null, documento_emissao: emissao };
    tx.atualizar("Atendimento", id, { hash_sha256: null, documento_estado: "PENDENTE",
      documento_nome: null, documento_modelo: null, documento_gerado_em: null,
      documento_emissao: emissao, selo_integridade: R.seloDoAtendimento(amb, novo, valores) });
    R.auditar(ctx, "REEMITIR", "Documento", id, "hash_sha256", at.hash_sha256 || null, null);
    return { status: 200, corpo: { ...resumo(tx.obter("Atendimento", id)), reemitido: true } };
  }

  // ---------- aditamentos ----------

  const aditamentoDict = (r) => ({ id: r.id_aditamento, id_atendimento: r.id_atendimento,
    texto: r.texto, autor: r.autor_email, criado_em: r.criado_em });

  function criarAditamento(ctx) {
    const { tx, usuario, amb } = ctx;
    exigirResponsavelTecnico(usuario, "registrar aditamentos");
    const idAt = ctx.req.params[0];
    const c = V.objeto(ctx.req.corpo);
    const texto = V.preenchido(c, "texto");
    const at = R.obterAtendimento(tx, idAt);
    if (at.status !== "ENCERRADO") {
      throw R.erro(409, { codigo: "atendimento_nao_encerrado",
        mensagem: "Aditamento só se aplica a atendimento encerrado." });
    }
    const id = V.textoOpcional(c, "id") || amb.novoId();
    const existente = tx.obter("Aditamento", id);
    if (existente) return { status: 201, corpo: aditamentoDict(existente) };
    tx.inserir("Aditamento", { id_aditamento: id, id_atendimento: idAt, texto,
      autor_email: usuario.email, criado_em: amb.agora() });
    R.auditar(ctx, "CRIAR", "Aditamento", id);
    return { status: 201, corpo: aditamentoDict(tx.obter("Aditamento", id)) };
  }

  function listarAditamentos(ctx) {
    R.obterAtendimento(ctx.tx, ctx.req.params[0]);
    const linhas = ctx.tx.onde("Aditamento", (a) => a.id_atendimento === ctx.req.params[0])
      .sort((a, b) => (a.criado_em < b.criado_em ? -1 : (a.criado_em > b.criado_em ? 1 : 0)));
    return { status: 200, corpo: linhas.map(aditamentoDict) };
  }

  // ---------- modelo do tipo (Google Docs) ----------

  function vincularModelo(ctx) {
    const { tx, amb } = ctx;
    const idTipo = ctx.req.params[0];
    const tipo = tx.obter("TipoAtendimento", idTipo);
    if (!tipo) throw R.erro(404, "tipo de atendimento não encontrado");
    const c = V.objeto(ctx.req.corpo);
    const modelo = V.textoOpcional(c, "modelo");
    if (modelo === undefined) throw V.invalido("modelo", "Field required");
    let marcadores = [];
    let novo = R.txt(modelo);
    if (novo) {
      try {
        if (amb.documentos.resolverModelo) novo = amb.documentos.resolverModelo(novo);
        marcadores = [...amb.documentos.marcadoresDoModelo(novo)];
      } catch (_) {
        throw R.erro(422, { codigo: "arquivo_invalido",
          mensagem: "Não foi possível abrir o modelo informado. Confira o endereço e o acesso." });
      }
      const permitidos = new Set([...MARCADORES_RESERVADOS,
        ...R.camposDoTipo(tx, idTipo).map((x) => x.nome)]);
      const invalidos = marcadores.filter((m) => !permitidos.has(m)).sort();
      if (invalidos.length) {
        throw R.erro(422, { codigo: "marcadores_invalidos",
          mensagem: "O modelo usa marcadores que não existem para este tipo.",
          marcadores: invalidos });
      }
    }
    tx.atualizar("TipoAtendimento", idTipo, { arquivo_template: novo, atualizado_em: amb.agora() });
    R.auditar(ctx, "ALTERAR", "TipoAtendimento", idTipo, "arquivo_template",
      tipo.arquivo_template, novo);
    return { status: 200, corpo: { arquivo_template: novo, marcadores: marcadores.sort() } };
  }

  R.ROTAS.push(
    { m: "POST", r: /^\/api\/atendimentos\/([^/]+)\/encerrar$/, perfis: ["VETERINARIO", "ADMIN"],
      grava: true, h: encerrar },
    { m: "GET", r: /^\/api\/atendimentos\/([^/]+)\/documento$/, perfis: CLINICOS, grava: true,
      h: documento },
    { m: "POST", r: /^\/api\/atendimentos\/([^/]+)\/documento\/anexar$/,
      perfis: ["VETERINARIO", "ADMIN", "SECRETARIA"], grava: true, h: anexarDocumento },
    { m: "POST", r: /^\/api\/atendimentos\/([^/]+)\/documento\/reemitir$/,
      perfis: ["VETERINARIO", "ADMIN"], grava: true, h: reemitirDocumento },
    { m: "GET", r: /^\/api\/atendimentos\/([^/]+)\/verificacao$/, perfis: CLINICOS, grava: false,
      h: verificar },
    { m: "POST", r: /^\/api\/atendimentos\/([^/]+)\/aditamentos$/, perfis: ["VETERINARIO", "ADMIN"],
      grava: true, h: criarAditamento },
    { m: "GET", r: /^\/api\/atendimentos\/([^/]+)\/aditamentos$/, perfis: CLINICOS, grava: false,
      h: listarAditamentos },
    { m: "PUT", r: /^\/api\/tipos\/([^/]+)\/modelo$/, perfis: ["ADMIN"], grava: true,
      h: vincularModelo },
  );
})(RoniVet);
