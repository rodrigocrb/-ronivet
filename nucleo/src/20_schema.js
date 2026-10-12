/* Esquema das tabelas: colunas, chaves e valores padrão. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};

(function (R) {
  "use strict";

  const AUDITORIA_COMUM = ["criado_em", "criado_por", "atualizado_em", "atualizado_por"];

  /** chave: colunas da chave primária; colunas: cabeçalho da aba; padrao: valores iniciais. */
  const TABELAS = {
    Usuario: {
      chave: ["email"],
      colunas: ["email", "token_agenda", "nome", "perfil", "crmv", "ativo"],
      padrao: { ativo: "SIM" },
    },
    Tutor: {
      chave: ["id_tutor"],
      colunas: ["id_tutor", "nome", "telefone", "cpf", "email", "endereco", "ciencia_finalidade_em",
        "aceita_contato", "consentimento_em", "consentimento_por", "ativo", ...AUDITORIA_COMUM],
      padrao: { aceita_contato: "NAO", ativo: "SIM" },
    },
    Animal: {
      chave: ["id_animal"],
      colunas: ["id_animal", "id_tutor", "nome", "especie", "sexo", "raca", "data_nascimento",
        "pelagem", "ativo", ...AUDITORIA_COMUM],
      padrao: { sexo: "INDEFINIDO", ativo: "SIM" },
    },
    TipoAtendimento: {
      chave: ["id_tipo"],
      colunas: ["id_tipo", "nome", "duracao_min", "arquivo_template", "ativo", "criado_em",
        "atualizado_em"],
      padrao: { ativo: "SIM" },
    },
    CampoDef: {
      chave: ["id_campo"],
      colunas: ["id_campo", "id_tipo", "nome", "rotulo", "tipo_dado", "opcoes", "obrigatorio",
        "ordem", "papel", "ativo"],
      padrao: { obrigatorio: "NAO", ordem: 0, ativo: "SIM" },
    },
    Atendimento: {
      chave: ["id_atendimento"],
      colunas: ["id_atendimento", "id_animal", "id_tipo", "inicio", "duracao_min", "status",
        "veterinario_email", "encerrado_em", "arquivo_pdf", "hash_sha256", "selo_integridade",
        "versao", ...AUDITORIA_COMUM, "documento_estado", "documento_nome", "documento_modelo",
        "documento_gerado_em", "documento_emissao"],
      padrao: { status: "AGENDADO", versao: 1 },
    },
    CampoValor: {
      chave: ["id_atendimento", "id_campo"],
      colunas: ["id_atendimento", "id_campo", "valor", "atualizado_em", "atualizado_por"],
      padrao: {},
    },
    Vacina: {
      chave: ["id_vacina"],
      colunas: ["id_vacina", "id_animal", "id_atendimento", "produto", "lote", "data_aplicacao",
        "proxima_dose", "criado_em"],
      padrao: {},
    },
    Aditamento: {
      chave: ["id_aditamento"],
      colunas: ["id_aditamento", "id_atendimento", "texto", "autor_email", "criado_em"],
      padrao: {},
    },
    ContatoCampanha: {
      chave: ["id_contato"],
      colunas: ["id_contato", "id_animal", "id_vacina", "data_contato", "resultado",
        "registrado_por"],
      padrao: {},
    },
    Config: {
      chave: ["dia_semana"],
      colunas: ["dia_semana", "atende", "inicio", "fim", "duracao_min"],
      padrao: {},
    },
    Auditoria: {
      chave: ["id_auditoria"],
      colunas: ["id_auditoria", "data_hora", "usuario_email", "acao", "entidade", "id_entidade",
        "campo", "valor_anterior", "valor_novo", "aparelho"],
      padrao: {},
    },
    Convite: {
      chave: ["id_convite"],
      colunas: ["id_convite", "codigo_hash", "perfil", "nome", "crmv", "email_destino", "telefone",
        "criado_por", "criado_em", "expira_em", "estado", "aceito_por", "aceito_em",
        "enviado_email_em"],
      padrao: { estado: "PENDENTE" },
    },
    // Metadados do sistema (reservado).
    Meta: { chave: ["chave"], colunas: ["chave", "valor"], padrao: {} },
    // Diário de operações: idempotência por id de operação e reversão de gravações interrompidas.
    Operacao: {
      chave: ["id_op"],
      colunas: ["id_op", "estado", "usuario_email", "resultado", "desfazer", "criado_em",
        "concluido_em"],
      padrao: {},
    },
  };

  R.TABELAS = TABELAS;

  /** Chave primária (objeto) de uma linha. */
  R.chaveDaLinha = (tabela, linha) => {
    const saida = {};
    for (const c of TABELAS[tabela].chave) saida[c] = linha[c];
    return saida;
  };

  /** Linha completa: todas as colunas, com os padrões da tabela e null no resto. */
  R.completarLinha = (tabela, parcial) => {
    const def = TABELAS[tabela];
    const linha = {};
    for (const c of def.colunas) {
      linha[c] = parcial[c] !== undefined ? parcial[c]
        : (def.padrao[c] !== undefined ? def.padrao[c] : null);
    }
    return linha;
  };
})(RoniVet);
