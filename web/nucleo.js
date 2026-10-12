/* GERADO por nucleo/montar_nucleo.js a partir de nucleo/src. Não edite. */

/* ---- 00_base.js ---- */
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


/* ---- 10_cpf.js ---- */
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


/* ---- 11_tempo.js ---- */
/* Datas e horas locais da clínica, sem fuso: textos AAAA-MM-DD e AAAA-MM-DDTHH:MM.
 * Toda aritmética usa Date.UTC, para não sofrer com horário de verão do ambiente. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};

(function (R) {
  "use strict";

  const FORMATO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
  const FORMATO_INICIO = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;
  const FORMATO_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

  const pad = (n, t = 2) => String(n).padStart(t, "0");

  function dataValida(texto) {
    const m = FORMATO_DATA.exec(String(texto || ""));
    if (!m) return false;
    const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(Date.UTC(a, me - 1, d));
    return dt.getUTCFullYear() === a && dt.getUTCMonth() === me - 1 && dt.getUTCDate() === d;
  }

  /** 0 = domingo ... 6 = sábado. */
  function diaSemana(isoData) {
    const [a, m, d] = isoData.split("-").map(Number);
    return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  }

  function horaEmMinutos(hhmm) {
    const [h, m] = hhmm.split(":");
    return Number(h) * 60 + Number(m);
  }

  /** Minutos desde 1970 de um AAAA-MM-DDTHH:MM (suficiente para comparar intervalos). */
  function emMinutos(inicio) {
    const m = FORMATO_INICIO.exec(inicio);
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) / 60000;
  }

  function dePartes(minutosEpoch) {
    const dt = new Date(minutosEpoch * 60000);
    return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
      + `T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`;
  }

  function somarMinutos(inicio, minutos) {
    return dePartes(emMinutos(inicio) + minutos);
  }

  /** AAAA-MM-DDTHH:MM válido (inclusive calendário) ou lança 422. */
  function parseInicio(texto) {
    if (!FORMATO_INICIO.test(String(texto || ""))) {
      throw R.erro(422, "início deve ser AAAA-MM-DDTHH:MM");
    }
    if (!dataValida(texto.slice(0, 10))) throw R.erro(422, "data/hora inválida");
    return texto;
  }

  function somarDias(isoData, n) {
    const [a, m, d] = isoData.split("-").map(Number);
    const dt = new Date(Date.UTC(a, m - 1, d + n));
    return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }

  function somarMeses(isoData, meses) {
    const [a, m, d] = isoData.split("-").map(Number);
    const indice = a * 12 + (m - 1) + meses;
    const ano = Math.floor(indice / 12);
    const mes = (indice % 12) + 1;
    const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    return `${pad(ano, 4)}-${pad(mes)}-${pad(Math.min(d, ultimo))}`;
  }

  /** "2026-10-12" -> "12/10/2026". */
  function dataBR(isoData) {
    const [a, m, d] = isoData.split("-");
    return `${d}/${m}/${a}`;
  }

  R.tempo = {
    FORMATO_HORA, dataValida, diaSemana, horaEmMinutos, emMinutos, somarMinutos, parseInicio,
    somarDias, somarMeses, dataBR,
  };
})(RoniVet);


/* ---- 12_validacao.js ---- */
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


/* ---- 20_schema.js ---- */
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


/* ---- 21_repositorio_memoria.js ---- */
/* Repositório em memória: ler, aplicar, trava e arquivos. Tudo síncrono. É a base do banco
 * local do aparelho (web/repositorio-local.js grava em IndexedDB) e dos testes. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};

(function (R) {
  "use strict";

  /** Simula a morte do processo no meio da gravação: o código de produção não compensa. */
  class ProcessoInterrompido extends Error {}
  R.ProcessoInterrompido = ProcessoInterrompido;

  function mesmaChave(tabela, linha, chave) {
    return R.TABELAS[tabela].chave.every((c) => String(linha[c]) === String(chave[c]));
  }

  R.criarRepositorioMemoria = function criarRepositorioMemoria() {
    const dados = {};
    const arquivos = new Map();
    let travado = false;
    let aplicadas = 0;

    const tabela = (nome) => {
      if (!R.TABELAS[nome]) throw new Error(`tabela desconhecida: ${nome}`);
      return dados[nome] || (dados[nome] = []);
    };

    const repo = {
      /** Ganchos de teste: falha (erro comum) ou interrupção na n-ésima mutação aplicada. */
      falharNaMutacao: null,
      interromperNaMutacao: null,
      /** Chamado dentro da trava, depois de abrir a execução (simula outro processo tentando). */
      aoMeioDaGravacao: null,

      ler(nome) {
        return R.clonar(tabela(nome));
      },

      /** Cópia de todas as tabelas (usada pelo motor de replicação do aparelho). */
      exportarTudo() {
        const saida = {};
        for (const nome of Object.keys(dados)) saida[nome] = R.clonar(dados[nome]);
        return saida;
      },

      /** Troca o conteúdo de todas as tabelas pelo estado informado (reconstrução). */
      substituirTudo(estado) {
        for (const nome of Object.keys(dados)) delete dados[nome];
        for (const [nome, linhas] of Object.entries(estado || {})) {
          if (!R.TABELAS[nome]) throw new Error(`tabela desconhecida: ${nome}`);
          dados[nome] = R.clonar(linhas);
        }
      },

      /** Mutações aplicadas desde a criação (para posicionar falhas simuladas). */
      aplicadasAteAgora() { return aplicadas; },

      /** `tolerante`: usado na reversão; ignora o que já está (ou ainda não está) aplicado. */
      aplicar(mutacoes, opcoes) {
        const tolerante = !!(opcoes && opcoes.tolerante);
        for (const m of mutacoes) {
          aplicadas += 1;
          if (repo.interromperNaMutacao === aplicadas) {
            throw new ProcessoInterrompido("processo interrompido (simulado)");
          }
          if (repo.falharNaMutacao === aplicadas) throw new Error("falha de gravação (simulada)");
          const linhas = tabela(m.tabela);
          if (m.tipo === "inserir") {
            const chave = R.chaveDaLinha(m.tabela, m.linha);
            if (linhas.some((l) => mesmaChave(m.tabela, l, chave))) {
              if (tolerante) continue;
              throw new Error(`chave duplicada em ${m.tabela}`);
            }
            linhas.push(R.clonar(m.linha));
          } else if (m.tipo === "atualizar") {
            const alvo = linhas.find((l) => mesmaChave(m.tabela, l, m.chave));
            if (!alvo) {
              if (tolerante) continue;
              throw new Error(`linha inexistente em ${m.tabela}`);
            }
            Object.assign(alvo, R.clonar(m.mudancas));
          } else if (m.tipo === "excluir") {
            const i = linhas.findIndex((l) => mesmaChave(m.tabela, l, m.chave));
            if (i >= 0) linhas.splice(i, 1);
          } else {
            throw new Error(`mutação desconhecida: ${m.tipo}`);
          }
        }
      },

      /** Exclusão mútua. Já travado (outra execução em andamento): responde "ocupado". */
      trava(fn) {
        if (travado) {
          throw R.erro(503, { codigo: "sistema_ocupado",
            mensagem: "O sistema está ocupado. Tente novamente em instantes." });
        }
        travado = true;
        try {
          return fn();
        } finally {
          travado = false;
        }
      },

      gravarArquivo(caminho, conteudo) { arquivos.set(caminho, conteudo); },
      lerArquivo(caminho) { return arquivos.has(caminho) ? arquivos.get(caminho) : null; },
      existeArquivo(caminho) { return arquivos.has(caminho); },
      excluirArquivo(caminho) { arquivos.delete(caminho); },
      listarArquivos() { return [...arquivos.keys()]; },
    };
    return repo;
  };
})(RoniVet);


/* ---- 22_tx.js ---- */
/* Unidade de trabalho: leituras com sobreposição das gravações pendentes e buffer de mutações.
 * Nada vai ao repositório até o commit feito por executarGravacao. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};

(function (R) {
  "use strict";

  function comoChave(nome, chave) {
    if (chave !== null && typeof chave === "object") return chave;
    return { [R.TABELAS[nome].chave[0]]: chave };
  }

  R.criarTx = function criarTx(repo) {
    const copia = {};
    const mutacoes = [];
    const compensacoes = [];

    const linhas = (nome) => {
      if (!R.TABELAS[nome]) throw new Error(`tabela desconhecida: ${nome}`);
      return copia[nome] || (copia[nome] = repo.ler(nome));
    };
    const casa = (nome, linha, chave) => R.TABELAS[nome].chave
      .every((c) => String(linha[c]) === String(chave[c]));

    return {
      /** Todas as linhas da tabela, na ordem de inserção (cópias). */
      todos(nome) {
        return R.clonar(linhas(nome));
      },

      obter(nome, chave) {
        const k = comoChave(nome, chave);
        const achada = linhas(nome).find((l) => casa(nome, l, k));
        return achada ? R.clonar(achada) : null;
      },

      onde(nome, predicado) {
        return R.clonar(linhas(nome).filter(predicado));
      },

      inserir(nome, parcial) {
        const linha = R.completarLinha(nome, parcial);
        const chave = R.chaveDaLinha(nome, linha);
        if (linhas(nome).some((l) => casa(nome, l, chave))) {
          throw new Error(`chave duplicada em ${nome}`);
        }
        linhas(nome).push(linha);
        mutacoes.push({ tabela: nome, tipo: "inserir", linha: R.clonar(linha) });
        return R.clonar(linha);
      },

      /** Altera colunas da linha; ignora (sem mutação) quando nada muda. */
      atualizar(nome, chave, mudancas) {
        const k = comoChave(nome, chave);
        const alvo = linhas(nome).find((l) => casa(nome, l, k));
        if (!alvo) throw new Error(`linha inexistente em ${nome}`);
        const efetivas = {};
        const antes = {};
        for (const [coluna, novo] of Object.entries(mudancas)) {
          const valor = novo === undefined ? null : novo;
          if (alvo[coluna] !== valor) {
            antes[coluna] = alvo[coluna];
            efetivas[coluna] = valor;
          }
        }
        if (!Object.keys(efetivas).length) return R.clonar(alvo);
        Object.assign(alvo, efetivas);
        mutacoes.push({ tabela: nome, tipo: "atualizar", chave: R.chaveDaLinha(nome, alvo),
          mudancas: R.clonar(efetivas), antes: R.clonar(antes) });
        return R.clonar(alvo);
      },

      excluir(nome, chave) {
        const k = comoChave(nome, chave);
        const i = linhas(nome).findIndex((l) => casa(nome, l, k));
        if (i < 0) return;
        const [removida] = linhas(nome).splice(i, 1);
        mutacoes.push({ tabela: nome, tipo: "excluir", chave: R.chaveDaLinha(nome, removida),
          linha: R.clonar(removida) });
      },

      mutacoes() {
        return R.clonar(mutacoes);
      },

      /** Efeito fora das tabelas (ex.: arquivo gravado) a desfazer se a operação falhar. */
      registrarCompensacao(fn) {
        compensacoes.push(fn);
      },

      compensacoes() {
        return compensacoes.slice();
      },

      temMutacoes() {
        return mutacoes.length > 0;
      },
    };
  };

  /** Mutações que desfazem, em ordem inversa, as informadas. */
  R.inverterMutacoes = function inverterMutacoes(mutacoes) {
    const saida = [];
    for (let i = mutacoes.length - 1; i >= 0; i -= 1) {
      const m = mutacoes[i];
      if (m.tipo === "inserir") {
        saida.push({ tabela: m.tabela, tipo: "excluir", chave: R.chaveDaLinha(m.tabela, m.linha) });
      } else if (m.tipo === "atualizar") {
        saida.push({ tabela: m.tabela, tipo: "atualizar", chave: m.chave, mudancas: m.antes });
      } else if (m.tipo === "excluir") {
        saida.push({ tabela: m.tabela, tipo: "inserir", linha: m.linha });
      }
    }
    return saida;
  };
})(RoniVet);


/* ---- 30_execucao.js ---- */
/* Execução de operações: exclusão mútua, idempotência por id de operação e diário que
 * garante "tudo ou nada" mesmo sem transações (design 3 e 4).
 *
 * Fluxo de uma gravação, sempre dentro da trava:
 *   1. reverte operações EM_ANDAMENTO deixadas por execuções interrompidas;
 *   2. se o id da operação já foi CONCLUIDA, devolve o resultado guardado;
 *   3. executa o tratador contra uma unidade de trabalho (nada é gravado ainda);
 *   4. grava no diário (EM_ANDAMENTO + mutações que desfazem), aplica as mutações e marca
 *      CONCLUIDA com o resultado. Falha ao aplicar: desfaz e marca REVERTIDA. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};

(function (R) {
  "use strict";

  /** Limite prático de uma célula de planilha é 50.000 caracteres. */
  const LIMITE_DIARIO = 45000;
  /** Tabelas cujas gravações não alteram os dados (não mudam a versão do cache offline). */

  function recuperarInterrompidas(repo, amb) {
    const pendentes = repo.ler("Operacao").filter((o) => o.estado === "EM_ANDAMENTO");
    for (const op of pendentes) {
      const desfazer = JSON.parse(op.desfazer || "[]");
      repo.aplicar(desfazer, { tolerante: true });
      repo.aplicar([{ tabela: "Operacao", tipo: "atualizar", chave: { id_op: op.id_op },
        mudancas: { estado: "REVERTIDA", desfazer: "", concluido_em: amb.agora() } }]);
    }
  }

  function compensar(tx) {
    for (const fn of tx.compensacoes().reverse()) {
      try { fn(); } catch (_) { /* melhor esforço */ }
    }
  }

  /**
   * Grava as mutações da unidade de trabalho com diário e reversão. `resultado` é o que fica
   * guardado para idempotência. Lança HttpErro 500/413 se não for possível gravar.
   */
  function persistir(repo, amb, tx, idOp, usuarioEmail, previa, resultado) {
    const mutacoes = tx.mutacoes();
    const inversas = R.inverterMutacoes(mutacoes);
    const desfazer = JSON.stringify(inversas);
    if (desfazer.length > LIMITE_DIARIO) {
      compensar(tx);
      throw R.erro(413, { codigo: "operacao_muito_grande",
        mensagem: "A operação é grande demais para ser gravada de uma vez." });
    }

    const linhaDiario = { id_op: idOp, estado: "EM_ANDAMENTO", usuario_email: usuarioEmail || null,
      resultado: "", desfazer, criado_em: amb.agora(), concluido_em: null };
    // Resposta com segredo (ex.: código de convite) não vai para a planilha: um reenvio recebe
    // um aviso em vez do segredo.
    const paraGuardar = resultado && resultado.naoGuardar
      ? { status: 409, corpo: { detail: { codigo: "resposta_nao_guardada",
        mensagem: "A operação já foi concluída e a resposta não é guardada por conter um segredo. "
          + "Crie um novo registro se precisar de outro código." } } }
      : { status: resultado.status, corpo: resultado.corpo };
    repo.aplicar(previa
      ? [{ tabela: "Operacao", tipo: "atualizar", chave: { id_op: idOp }, mudancas: linhaDiario }]
      : [{ tabela: "Operacao", tipo: "inserir", linha: R.completarLinha("Operacao", linhaDiario) }]);

    try {
      repo.aplicar(mutacoes);
      repo.aplicar([{ tabela: "Operacao", tipo: "atualizar", chave: { id_op: idOp },
        mudancas: { estado: "CONCLUIDA", resultado: JSON.stringify(paraGuardar), desfazer: "",
          concluido_em: amb.agora() } }]);
    } catch (e) {
      if (e instanceof R.ProcessoInterrompido) throw e;   // processo morto: nada a fazer aqui
      compensar(tx);
      try {
        repo.aplicar(inversas, { tolerante: true });
        repo.aplicar([{ tabela: "Operacao", tipo: "atualizar", chave: { id_op: idOp },
          mudancas: { estado: "REVERTIDA", desfazer: "", concluido_em: amb.agora() } }]);
      } catch (_) { /* a próxima execução reverte pelo diário */ }
      throw R.erro(500, { codigo: "falha_gravacao",
        mensagem: "Não foi possível gravar. Nada foi alterado; tente novamente." });
    }

  }

  /**
   * Executa `fn(tx)` como gravação. `fn` devolve { status, corpo } ou lança HttpErro.
   * opcoes: { idOp, usuarioEmail }.
   */
  R.executarGravacao = function executarGravacao(repo, amb, opcoes, fn) {
    return repo.trava(() => {
      recuperarInterrompidas(repo, amb);
      const idOp = (opcoes && opcoes.idOp) || amb.novoId();
      const usuarioEmail = opcoes && opcoes.usuarioEmail;
      const previa = repo.ler("Operacao").find((o) => o.id_op === idOp);
      if (previa && previa.estado === "CONCLUIDA") return JSON.parse(previa.resultado);

      const tx = R.criarTx(repo);
      if (repo.aoMeioDaGravacao) repo.aoMeioDaGravacao();
      let resultado;
      try {
        resultado = fn(tx);
      } catch (e) {
        // Recusa que registrou apenas auditoria (ex.: tentativa de alterar atendimento
        // encerrado): a trilha é gravada mesmo assim.
        const so = tx.mutacoes();
        if (e instanceof R.HttpErro && so.length && so.every((m) => m.tabela === "Auditoria")) {
          persistir(repo, amb, tx, amb.novoId(), usuarioEmail, null, { status: e.status });
        } else {
          compensar(tx);
        }
        throw e;
      }
      const resposta = { status: resultado.status, corpo: resultado.corpo };
      if (!tx.temMutacoes()) return resposta;
      persistir(repo, amb, tx, idOp, usuarioEmail, previa, resultado);
      return resposta;
    });
  };

  /** Leitura sem trava; qualquer gravação aqui é erro de programação. */
  R.executarLeitura = function executarLeitura(repo, fn) {
    const tx = R.criarTx(repo);
    const resultado = fn(tx);
    if (tx.temMutacoes()) throw new Error("tratador de leitura tentou gravar");
    return resultado;
  };
})(RoniVet);


/* ---- 40_identidade.js ---- */
/* Identidade, perfis e auditoria. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};

(function (R) {
  "use strict";

  const ESCREVEM = ["SECRETARIA", "ADMIN"];
  const EDITAM_ANIMAL = ["SECRETARIA", "ADMIN", "VETERINARIO"];
  const CLINICOS = ["VETERINARIO", "ADMIN"];

  R.GRUPOS = { ESCREVEM, EDITAM_ANIMAL, CLINICOS };

  /** Dados do usuário que o aplicativo pode ver. */
  R.usuarioPublico = (u) => ({ email: u.email, nome: u.nome, perfil: u.perfil, crmv: u.crmv });

  /**
   * Valida a credencial e devolve o e-mail (minúsculas) ou lança 401. No aparelho a credencial é
   * "fake:<email>", escolhida na entrada do aplicativo; só vale com `config.permitirLoginTeste`.
   */
  R.verificarCredencial = function verificarCredencial(config, credencial) {
    if (!credencial || typeof credencial !== "string") throw R.erro(401, "não autenticado");
    if (config.permitirLoginTeste && credencial.startsWith("fake:")) {
      const email = credencial.slice(5).trim().toLowerCase();
      if (!email.includes("@")) throw R.erro(401, "credencial inválida");
      return email;
    }
    throw R.erro(401, "credencial inválida");
  };

  /** Usuário ativo cadastrado para o e-mail, ou null. */
  R.usuarioAtivo = (repo, email) => repo.ler("Usuario")
    .find((u) => u.email === email && u.ativo === "SIM") || null;

  /** Registra na trilha (somente inserção) dentro da unidade de trabalho. */
  R.auditar = function auditar(ctx, acao, entidade, idEntidade, campo, anterior, novo) {
    const texto = (v) => (v === null || v === undefined ? null : String(v));
    ctx.tx.inserir("Auditoria", {
      id_auditoria: ctx.amb.novoId(),
      data_hora: ctx.amb.agora(),
      usuario_email: (ctx.usuario && ctx.usuario.email) || ctx.email,
      acao,
      entidade,
      id_entidade: texto(idEntidade),
      campo: texto(campo),
      valor_anterior: texto(anterior),
      valor_novo: texto(novo),
      aparelho: ctx.amb.aparelho ? ctx.amb.aparelho() : null,   // só no aparelho (modo local)
    });
  };
})(RoniVet);


/* ---- 60_cadastro.js ---- */
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


/* ---- 61_agenda.js ---- */
/* Horários de atendimento, disponibilidade e agendamento. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};
RoniVet.ROTAS = RoniVet.ROTAS || [];

(function (R) {
  "use strict";

  const V = R.validar;
  const T = R.tempo;
  const { ESCREVEM } = R.GRUPOS;
  const OCUPAM_HORARIO = ["AGENDADO", "ENCERRADO"];

  // ---------- configuração de horários ----------

  R.configCompleta = (tx) => {
    const existentes = new Map(tx.todos("Config").map((c) => [Number(c.dia_semana), c]));
    const saida = [];
    for (let dia = 0; dia < 7; dia += 1) {
      const r = existentes.get(dia);
      saida.push(r
        ? { dia_semana: dia, atende: r.atende, inicio: r.inicio, fim: r.fim,
          duracao_min: r.duracao_min }
        : { dia_semana: dia, atende: "NAO", inicio: null, fim: null, duracao_min: null });
    }
    return saida;
  };

  function obterConfig(ctx) {
    return { status: 200, corpo: R.configCompleta(ctx.tx) };
  }

  function salvarConfig(ctx) {
    const { tx } = ctx;
    const c = V.objeto(ctx.req.corpo);
    if (!Array.isArray(c.dias)) throw V.invalido("dias", "Field required");
    const dias = c.dias.map((d, i) => {
      const o = V.objeto(d);
      const dia = V.inteiroObrigatorio(o, "dia_semana");
      if (dia < 0 || dia > 6) throw V.invalido(`dias.${i}.dia_semana`, "dia_semana entre 0 e 6");
      const atende = V.textoObrigatorio(o, "atende");
      V.opcao(atende, `dias.${i}.atende`, ["SIM", "NAO"]);
      return { dia_semana: dia, atende, inicio: V.textoOpcional(o, "inicio") ?? null,
        fim: V.textoOpcional(o, "fim") ?? null, duracao_min: V.inteiroOpcional(o, "duracao_min") };
    });
    for (const d of dias) {
      if (d.atende !== "SIM") continue;
      if (!(d.inicio && d.fim && T.FORMATO_HORA.test(d.inicio) && T.FORMATO_HORA.test(d.fim))) {
        throw R.erro(422, "informe início e fim (HH:MM) para dias com atendimento");
      }
      if (T.horaEmMinutos(d.inicio) >= T.horaEmMinutos(d.fim)) {
        throw R.erro(422, "início deve ser anterior ao fim");
      }
      if (!d.duracao_min || d.duracao_min <= 0) throw R.erro(422, "informe a duração do horário");
    }
    const antes = new Map(R.configCompleta(tx).map((x) => [x.dia_semana, x]));
    for (const d of dias) {
      const novo = d.atende === "NAO"
        ? { dia_semana: d.dia_semana, atende: "NAO", inicio: null, fim: null, duracao_min: null }
        : d;
      if (tx.obter("Config", d.dia_semana)) {
        tx.atualizar("Config", d.dia_semana, { atende: novo.atende, inicio: novo.inicio,
          fim: novo.fim, duracao_min: novo.duracao_min });
      } else {
        tx.inserir("Config", novo);
      }
      if (JSON.stringify(antes.get(d.dia_semana)) !== JSON.stringify(novo)) {
        R.auditar(ctx, "ALTERAR", "Config", String(d.dia_semana), "horario",
          JSON.stringify(antes.get(d.dia_semana)), JSON.stringify(novo));
      }
    }
    return { status: 200, corpo: R.configCompleta(tx) };
  }

  // ---------- disponibilidade ----------

  const configDoDia = (tx, dia) => {
    const c = tx.obter("Config", T.diaSemana(dia));
    return c && c.atende === "SIM" ? c : null;
  };

  /** Intervalos [inicio, fim) em minutos ocupados no dia (agendados e encerrados). */
  const ocupadosNoDia = (tx, dia, ignorar) => tx.todos("Atendimento")
    .filter((a) => OCUPAM_HORARIO.includes(a.status) && a.inicio.slice(0, 10) === dia
      && a.id_atendimento !== ignorar)
    .map((a) => { const ini = T.emMinutos(a.inicio); return [ini, ini + a.duracao_min]; });

  const sobrepoe = (ini, fim, ocupados) => ocupados.some(([oi, of]) => ini < of && oi < fim);

  function horariosDoDia(ctx) {
    const { tx, req } = ctx;
    const data = req.query.data;
    if (!data) throw V.invalido("data", "Field required");
    if (!T.dataValida(data)) throw R.erro(422, "data inválida");
    let duracaoParam = null;
    if (req.query.duracao_min !== undefined) {
      duracaoParam = Number(req.query.duracao_min);
      if (!Number.isInteger(duracaoParam) || duracaoParam <= 0) {
        throw V.invalido("duracao_min", "Input should be greater than 0");
      }
    }
    const cfg = configDoDia(tx, data);
    if (!cfg) return { status: 200, corpo: [] };
    const passo = cfg.duracao_min;
    const duracao = duracaoParam || passo;
    const ocupados = ocupadosNoDia(tx, data);
    const ini = T.horaEmMinutos(cfg.inicio);
    const fim = T.horaEmMinutos(cfg.fim);
    const base = T.emMinutos(`${data}T00:00`);
    const horarios = [];
    for (let minuto = ini; minuto <= fim - duracao; minuto += passo) {
      const inicioMin = base + minuto;
      horarios.push({
        inicio: T.somarMinutos(`${data}T00:00`, minuto),
        livre: !sobrepoe(inicioMin, inicioMin + duracao, ocupados),
      });
    }
    return { status: 200, corpo: horarios };
  }

  /** Lança 422 (fora do expediente) ou 409 (conflito), conforme a spec. */
  R.validarHorario = function validarHorario(tx, inicio, duracao, ignorar) {
    const dia = inicio.slice(0, 10);
    const cfg = configDoDia(tx, dia);
    const minutos = T.horaEmMinutos(inicio.slice(11));
    if (!cfg || minutos < T.horaEmMinutos(cfg.inicio)
      || minutos + duracao > T.horaEmMinutos(cfg.fim)) {
      throw R.erro(422, { codigo: "fora_do_expediente", mensagem: "Horário fora do expediente." });
    }
    const ini = T.emMinutos(inicio);
    if (sobrepoe(ini, ini + duracao, ocupadosNoDia(tx, dia, ignorar))) {
      throw R.erro(409, { codigo: "conflito_horario", mensagem: "Horário já ocupado." });
    }
  };

  // ---------- atendimentos ----------

  R.atendimentoDict = (tx, a) => {
    const animal = tx.obter("Animal", a.id_animal);
    const tutor = animal ? tx.obter("Tutor", animal.id_tutor) : null;
    const tipo = tx.obter("TipoAtendimento", a.id_tipo);
    return {
      id: a.id_atendimento, id_animal: a.id_animal, id_tipo: a.id_tipo, inicio: a.inicio,
      duracao_min: a.duracao_min, status: a.status,
      animal: animal ? animal.nome : null, especie: animal ? animal.especie : null,
      tutor: tutor ? tutor.nome : null, tipo: tipo ? tipo.nome : null, versao: a.versao,
    };
  };

  const obterAt = (tx, id) => {
    const a = tx.obter("Atendimento", id);
    if (!a) throw R.erro(404, "atendimento não encontrado");
    return a;
  };

  R.obterAtendimento = obterAt;

  function exigirNaoEncerrado(ctx, a) {
    if (a.status === "ENCERRADO") {
      R.auditar(ctx, "REJEITAR", "Atendimento", a.id_atendimento, "status", "ENCERRADO",
        "alteração recusada");
      throw R.erro(409, { codigo: "atendimento_encerrado",
        mensagem: "Atendimento encerrado não pode ser alterado." });
    }
    if (a.status === "CANCELADO") {
      throw R.erro(409, { codigo: "atendimento_cancelado", mensagem: "Atendimento cancelado." });
    }
  }

  function duracaoPositiva(c) {
    const d = V.inteiroOpcional(c, "duracao_min");
    if (d !== null && d <= 0) throw V.invalido("duracao_min", "duração deve ser positiva");
    return d;
  }

  function agendar(ctx) {
    const { tx, usuario, amb } = ctx;
    const c = V.objeto(ctx.req.corpo);
    const idAnimal = V.textoObrigatorio(c, "id_animal");
    const idTipo = V.textoObrigatorio(c, "id_tipo");
    const inicioTxt = V.textoObrigatorio(c, "inicio");
    const duracaoIn = duracaoPositiva(c);
    const id = V.textoOpcional(c, "id") || amb.novoId();

    const existente = tx.obter("Atendimento", id);
    if (existente) return { status: 201, corpo: R.atendimentoDict(tx, existente) };  // reenvio
    const animal = tx.obter("Animal", idAnimal);
    if (!animal || animal.ativo !== "SIM") throw R.erro(404, "animal não encontrado");
    const tipo = tx.obter("TipoAtendimento", idTipo);
    if (!tipo || tipo.ativo !== "SIM") throw R.erro(404, "tipo de atendimento não encontrado");
    const inicio = T.parseInicio(inicioTxt);
    const duracao = duracaoIn || tipo.duracao_min;
    R.validarHorario(tx, inicio, duracao);
    const agora = amb.agora();
    tx.inserir("Atendimento", { id_atendimento: id, id_animal: idAnimal, id_tipo: idTipo, inicio,
      duracao_min: duracao, status: "AGENDADO", versao: 1, criado_em: agora,
      criado_por: usuario.email, atualizado_em: agora, atualizado_por: usuario.email });
    R.auditar(ctx, "CRIAR", "Atendimento", id);
    return { status: 201, corpo: R.atendimentoDict(tx, obterAt(tx, id)) };
  }

  function remarcar(ctx) {
    const { tx, usuario, amb } = ctx;
    const id = ctx.req.params[0];
    const c = V.objeto(ctx.req.corpo);
    const inicioTxt = V.textoObrigatorio(c, "inicio");
    const duracaoIn = duracaoPositiva(c);
    const atual = obterAt(tx, id);
    exigirNaoEncerrado(ctx, atual);
    const inicio = T.parseInicio(inicioTxt);
    const duracao = duracaoIn || atual.duracao_min;
    R.validarHorario(tx, inicio, duracao, id);
    tx.atualizar("Atendimento", id, { inicio, duracao_min: duracao, versao: atual.versao + 1,
      atualizado_em: amb.agora(), atualizado_por: usuario.email });
    R.auditar(ctx, "ALTERAR", "Atendimento", id, "inicio", atual.inicio, inicio);
    return { status: 200, corpo: R.atendimentoDict(tx, obterAt(tx, id)) };
  }

  function cancelar(ctx) {
    const { tx, usuario, amb } = ctx;
    const id = ctx.req.params[0];
    const atual = obterAt(tx, id);
    if (atual.status === "CANCELADO") return { status: 200, corpo: R.atendimentoDict(tx, atual) };
    exigirNaoEncerrado(ctx, atual);
    tx.atualizar("Atendimento", id, { status: "CANCELADO", versao: atual.versao + 1,
      atualizado_em: amb.agora(), atualizado_por: usuario.email });
    R.auditar(ctx, "ALTERAR", "Atendimento", id, "status", atual.status, "CANCELADO");
    return { status: 200, corpo: R.atendimentoDict(tx, obterAt(tx, id)) };
  }

  function obterAtendimentoRota(ctx) {
    return { status: 200, corpo: R.atendimentoDict(ctx.tx, obterAt(ctx.tx, ctx.req.params[0])) };
  }

  function agenda(ctx) {
    const { tx, req } = ctx;
    const de = req.query.de;
    if (!de) throw V.invalido("de", "Field required");
    const ate = req.query.ate || de;
    if (!T.dataValida(de) || !T.dataValida(ate)) throw R.erro(422, "data inválida");
    if (ate < de) throw R.erro(422, "intervalo inválido");
    const linhas = tx.todos("Atendimento")
      .filter((a) => a.inicio.slice(0, 10) >= de && a.inicio.slice(0, 10) <= ate)
      .sort((a, b) => (a.inicio < b.inicio ? -1 : (a.inicio > b.inicio ? 1 : 0)));
    return { status: 200, corpo: linhas.map((a) => R.atendimentoDict(tx, a)) };
  }

  R.ROTAS.push(
    { m: "GET", r: /^\/api\/config-horarios$/, perfis: null, grava: false, h: obterConfig },
    { m: "PUT", r: /^\/api\/config-horarios$/, perfis: ["ADMIN"], grava: true, h: salvarConfig },
    { m: "GET", r: /^\/api\/horarios$/, perfis: null, grava: false, h: horariosDoDia },
    { m: "POST", r: /^\/api\/atendimentos$/, perfis: ESCREVEM, grava: true, h: agendar },
    { m: "PATCH", r: /^\/api\/atendimentos\/([^/]+)$/, perfis: ESCREVEM, grava: true, h: remarcar },
    { m: "POST", r: /^\/api\/atendimentos\/([^/]+)\/cancelar$/, perfis: ESCREVEM, grava: true,
      h: cancelar },
    { m: "GET", r: /^\/api\/atendimentos\/([^/]+)$/, perfis: null, grava: false,
      h: obterAtendimentoRota },
    { m: "GET", r: /^\/api\/agenda$/, perfis: null, grava: false, h: agenda },
  );
})(RoniVet);


/* ---- 62_agendamentos.js ---- */
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


/* ---- 63_tipos.js ---- */
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


/* ---- 64_ficha.js ---- */
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


/* ---- 65_documentos.js ---- */
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


/* ---- 66_busca.js ---- */
/* Busca de atendimentos e painel por espécie/sexo. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};
RoniVet.ROTAS = RoniVet.ROTAS || [];

(function (R) {
  "use strict";

  const T = R.tempo;
  const STATUS = ["AGENDADO", "CANCELADO", "ENCERRADO"];
  const TELEFONE_PLANO = (t) => String(t || "").replace(/[ ()+-]/g, "");

  function dataOpcional(valor, nome) {
    if (!valor) return null;
    if (!T.dataValida(valor)) throw R.erro(422, `${nome} inválida`);
    return valor;
  }

  /** Somente dados de identificação (sem campos clínicos), para qualquer perfil. */
  function buscar(ctx) {
    const { tx, req } = ctx;
    const q = (req.query.q || "").trim();
    const { tipo, status } = req.query;
    if (status && !STATUS.includes(status)) throw R.erro(422, "status inválido");
    let limite = 100;
    if (req.query.limite !== undefined) {
      limite = Number(req.query.limite);
      if (!Number.isInteger(limite) || limite < 1 || limite > 500) {
        throw R.validar.invalido("limite", "Input should be between 1 and 500");
      }
    }
    const de = dataOpcional(req.query.de, "data inicial");
    const ate = dataOpcional(req.query.ate, "data final");
    const termo = R.normalizar(q);
    const digitos = R.apenasDigitos(termo);

    const animais = new Map(tx.todos("Animal").map((a) => [a.id_animal, a]));
    const tutores = new Map(tx.todos("Tutor").map((t) => [t.id_tutor, t]));
    const tipos = new Map(tx.todos("TipoAtendimento").map((t) => [t.id_tipo, t]));

    const linhas = [];
    for (const at of tx.todos("Atendimento")) {
      const animal = animais.get(at.id_animal);
      const tutor = animal && tutores.get(animal.id_tutor);
      const tp = tipos.get(at.id_tipo);
      if (!animal || !tutor || !tp) continue;
      if (termo && !(R.normalizar(tutor.nome).includes(termo)
        || R.normalizar(animal.nome).includes(termo)
        || (digitos && TELEFONE_PLANO(tutor.telefone).includes(digitos)))) continue;
      if (tipo && at.id_tipo !== tipo) continue;
      if (status && at.status !== status) continue;
      const dia = at.inicio.slice(0, 10);
      if (de && dia < de) continue;
      if (ate && dia > ate) continue;
      linhas.push({ id: at.id_atendimento, inicio: at.inicio, status: at.status, tipo: tp.nome,
        animal: animal.nome, especie: animal.especie, tutor: tutor.nome, id_tutor: tutor.id_tutor });
    }
    linhas.sort((a, b) => (a.inicio < b.inicio ? 1 : (a.inicio > b.inicio ? -1 : 0)));
    return { status: 200, corpo: linhas.slice(0, limite) };
  }

  /** Atendimentos encerrados por espécie e sexo no período; dados agregados. */
  function dashboard(ctx) {
    const { tx, req } = ctx;
    if (!req.query.de) throw R.validar.invalido("de", "Field required");
    if (!req.query.ate) throw R.validar.invalido("ate", "Field required");
    const d0 = dataOpcional(req.query.de, "data inicial");
    const d1 = dataOpcional(req.query.ate, "data final");
    if (d1 < d0) throw R.erro(422, "intervalo inválido");
    const animais = new Map(tx.todos("Animal").map((a) => [a.id_animal, a]));
    const cruzado = new Map();
    const porEspecie = new Map();
    const porSexo = { MACHO: 0, FEMEA: 0, INDEFINIDO: 0 };
    for (const at of tx.todos("Atendimento")) {
      if (at.status !== "ENCERRADO") continue;
      const dia = at.inicio.slice(0, 10);
      if (dia < d0 || dia > d1) continue;
      if (req.query.tipo && at.id_tipo !== req.query.tipo) continue;
      const animal = animais.get(at.id_animal);
      if (!animal) continue;
      const chave = `${animal.especie}\u0000${animal.sexo}`;
      cruzado.set(chave, (cruzado.get(chave) || 0) + 1);
      porEspecie.set(animal.especie, (porEspecie.get(animal.especie) || 0) + 1);
      porSexo[animal.sexo] += 1;
    }
    const cruz = [...cruzado.entries()].map(([k, total]) => {
      const [especie, sexo] = k.split("\u0000");
      return { especie, sexo, total };
    }).sort((a, b) => (a.especie < b.especie ? -1 : (a.especie > b.especie ? 1
      : (a.sexo < b.sexo ? -1 : 1))));
    const espOrd = [...porEspecie.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return { status: 200, corpo: {
      de: d0, ate: d1,
      total: espOrd.reduce((s, [, n]) => s + n, 0),
      por_especie: espOrd.map(([especie, total]) => ({ especie, total })),
      por_sexo: Object.entries(porSexo).map(([sexo, total]) => ({ sexo, total })),
      por_especie_sexo: cruz,
    } };
  }

  R.ROTAS.push(
    { m: "GET", r: /^\/api\/busca$/, perfis: null, grava: false, h: buscar },
    { m: "GET", r: /^\/api\/dashboard$/, perfis: ["ADMIN", "VETERINARIO"], grava: false,
      h: dashboard },
  );
})(RoniVet);


/* ---- 67_campanha.js ---- */
/* Campanha de reforço vacinal anual. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};
RoniVet.ROTAS = RoniVet.ROTAS || [];

(function (R) {
  "use strict";

  const V = R.validar;
  const T = R.tempo;
  const PERFIS = ["SECRETARIA", "ADMIN"];
  const ELIMINADO = "ELIMINADO";

  /** Próxima dose informada; senão, 12 meses após a aplicação. */
  const calcularVencimento = (aplicacao, proxima) => proxima || T.somarMeses(aplicacao, 12);

  function diasDe(req) {
    if (req.query.dias === undefined) return 30;
    const d = Number(req.query.dias);
    if (!Number.isInteger(d) || d < 0 || d > 365) {
      throw V.invalido("dias", "Input should be between 0 and 365");
    }
    return d;
  }

  function hojeDe(ctx) {
    const h = ctx.req.query.hoje;
    if (!h) return ctx.amb.agora().slice(0, 10);
    if (!T.dataValida(h)) throw R.erro(422, "data inválida");
    return h;
  }

  function itensDaCampanha(tx, hoje, dias) {
    const limite = T.somarDias(hoje, dias);
    const animais = new Map(tx.todos("Animal").map((a) => [a.id_animal, a]));
    const tutores = new Map(tx.todos("Tutor").map((t) => [t.id_tutor, t]));
    // Aplicação mais recente de cada vacina (produto) por animal.
    const maisRecente = new Map();
    for (const v of tx.todos("Vacina")) {
      const chave = `${v.id_animal}\u0000${(v.produto || "").toLowerCase()}`;
      const atual = maisRecente.get(chave);
      if (!atual || v.data_aplicacao > atual.data_aplicacao
        || (v.data_aplicacao === atual.data_aplicacao && v.criado_em >= atual.criado_em)) {
        maisRecente.set(chave, v);
      }
    }
    const contatos = new Map();
    for (const c of tx.todos("ContatoCampanha")) {
      if (!contatos.has(c.id_animal) || c.data_contato > contatos.get(c.id_animal)) {
        contatos.set(c.id_animal, c.data_contato);
      }
    }
    const saida = [];
    for (const v of maisRecente.values()) {
      const animal = animais.get(v.id_animal);
      const tutor = animal && tutores.get(animal.id_tutor);
      if (!animal || animal.ativo !== "SIM" || !tutor || tutor.ativo !== "SIM") continue;
      const vencimento = calcularVencimento(v.data_aplicacao, v.proxima_dose);
      if (vencimento > limite) continue;
      const autorizado = tutor.aceita_contato === "SIM" && tutor.telefone !== ELIMINADO;
      saida.push({
        id_vacina: v.id_vacina, id_animal: v.id_animal, animal: animal.nome,
        especie: animal.especie, vacina: v.produto, ultima_aplicacao: v.data_aplicacao,
        vencimento, situacao: vencimento < hoje ? "ATRASADO" : "A_VENCER", tutor: tutor.nome,
        telefone: autorizado ? tutor.telefone : null, contatar: autorizado,
        sem_autorizacao_de_contato: !autorizado,
        ultimo_contato: (contatos.get(v.id_animal) || "").slice(0, 10) || null,
      });
    }
    saida.sort((a, b) => (a.vencimento < b.vencimento ? -1 : (a.vencimento > b.vencimento ? 1
      : (a.animal < b.animal ? -1 : (a.animal > b.animal ? 1 : 0)))));
    return saida;
  }

  function listar(ctx) {
    return { status: 200, corpo: itensDaCampanha(ctx.tx, hojeDe(ctx), diasDe(ctx.req)) };
  }

  function registrarContato(ctx) {
    const { tx, usuario, amb } = ctx;
    const c = V.objeto(ctx.req.corpo);
    const idAnimal = V.textoObrigatorio(c, "id_animal");
    const idVacina = V.textoOpcional(c, "id_vacina") || null;
    const resultado = V.textoOpcional(c, "resultado");
    const id = V.textoOpcional(c, "id") || amb.novoId();
    const existente = tx.obter("ContatoCampanha", id);
    if (existente) return { status: 201, corpo: existente };
    if (!tx.obter("Animal", idAnimal)) throw R.erro(404, "animal não encontrado");
    if (idVacina && !tx.obter("Vacina", idVacina)) throw R.erro(404, "vacina não encontrada");
    tx.inserir("ContatoCampanha", { id_contato: id, id_animal: idAnimal, id_vacina: idVacina,
      data_contato: amb.agora(), resultado: resultado ? resultado.trim() : resultado ?? null,
      registrado_por: usuario.email });
    R.auditar(ctx, "CRIAR", "ContatoCampanha", id);
    return { status: 201, corpo: tx.obter("ContatoCampanha", id) };
  }

  /** CSV (separador ';', UTF-8 com BOM, abre direto no Excel) com as colunas da lista. */
  function exportar(ctx) {
    const { tx } = ctx;
    const hoje = hojeDe(ctx);
    const itens = itensDaCampanha(tx, hoje, diasDe(ctx.req));
    const celula = (v) => {
      const t = String(v === null || v === undefined ? "" : v);
      return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const linhas = [["Animal", "Espécie", "Vacina", "Última aplicação", "Vencimento", "Situação",
      "Tutor", "Telefone", "Contato autorizado", "Último contato"]];
    for (const i of itens) {
      linhas.push([i.animal, i.especie, i.vacina || "", i.ultima_aplicacao, i.vencimento,
        i.situacao, i.tutor, i.telefone || "", i.contatar ? "Sim" : "Não", i.ultimo_contato || ""]);
    }
    R.auditar(ctx, "CONSULTAR", "Campanha", null, "exportacao", null, `${itens.length} linhas`);
    return { status: 200, corpo: { tipo_conteudo: "text/csv; charset=utf-8",
      nome_arquivo: `campanha-vacinal-${hoje}.csv`,
      texto: `﻿${linhas.map((l) => l.map(celula).join(";")).join("\r\n")}\r\n` } };
  }

  R.itensDaCampanha = itensDaCampanha;
  R.ROTAS.push(
    { m: "GET", r: /^\/api\/campanha$/, perfis: PERFIS, grava: false, h: listar },
    { m: "POST", r: /^\/api\/campanha\/contatos$/, perfis: PERFIS, grava: true,
      h: registrarContato },
    { m: "GET", r: /^\/api\/campanha\/exportar$/, perfis: PERFIS, grava: true, h: exportar },
  );
})(RoniVet);


/* ---- 68_titular.js ---- */
/* Direitos do titular (LGPD): acesso e eliminação, preservando a guarda obrigatória. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};
RoniVet.ROTAS = RoniVet.ROTAS || [];

(function (R) {
  "use strict";

  const V = R.validar;
  const ELIMINADO = "ELIMINADO";

  const tutorDe = (tx, id) => {
    const t = tx.obter("Tutor", id);
    if (!t) throw R.erro(404, "tutor não encontrado");
    return t;
  };

  /** Reúne os dados pessoais do tutor e os registros dos seus animais (pedido de acesso). */
  function dadosDoTitular(ctx) {
    const { tx } = ctx;
    const id = ctx.req.params[0];
    const tutor = tutorDe(tx, id);
    const animais = tx.onde("Animal", (a) => a.id_tutor === id);
    const saida = { tutor, animais: [] };
    for (const a of animais) {
      const atendimentos = tx.onde("Atendimento", (x) => x.id_animal === a.id_animal)
        .sort((x, y) => (x.inicio < y.inicio ? -1 : (x.inicio > y.inicio ? 1 : 0)))
        .map((x) => ({ id_atendimento: x.id_atendimento, id_tipo: x.id_tipo, inicio: x.inicio,
          status: x.status, encerrado_em: x.encerrado_em, veterinario_email: x.veterinario_email,
          hash_sha256: x.hash_sha256 }));
      const vacinas = tx.onde("Vacina", (x) => x.id_animal === a.id_animal)
        .sort((x, y) => (x.data_aplicacao < y.data_aplicacao ? -1 : 1))
        .map((x) => ({ produto: x.produto, lote: x.lote, data_aplicacao: x.data_aplicacao,
          proxima_dose: x.proxima_dose }));
      saida.animais.push({ animal: a, atendimentos, vacinas });
    }
    R.auditar(ctx, "CONSULTAR", "Titular", id, "pedido_de_acesso", null, null);
    return { status: 200, corpo: saida };
  }

  /** Se houver atendimento encerrado (guarda obrigatória), elimina só os dados de contato. */
  function eliminar(ctx) {
    const { tx, usuario, amb } = ctx;
    const id = ctx.req.params[0];
    const c = V.objeto(ctx.req.corpo);
    const motivo = V.preenchido(c, "motivo");
    const tutor = tutorDe(tx, id);
    const idsAnimais = tx.onde("Animal", (a) => a.id_tutor === id).map((a) => a.id_animal);
    const atendimentos = tx.onde("Atendimento", (a) => idsAnimais.includes(a.id_animal));
    const encerrados = atendimentos.filter((a) => a.status === "ENCERRADO").length;
    let resultado;
    if (encerrados) {
      const agora = amb.agora();
      tx.atualizar("Tutor", id, { telefone: ELIMINADO, cpf: null, email: null, endereco: null,
        aceita_contato: "NAO", consentimento_em: agora, consentimento_por: usuario.email,
        atualizado_em: agora, atualizado_por: usuario.email });
      resultado = "contato_eliminado_guarda_mantida";
    } else {
      const idsAt = atendimentos.map((a) => a.id_atendimento);
      for (const x of tx.onde("ContatoCampanha", (k) => idsAnimais.includes(k.id_animal))) {
        tx.excluir("ContatoCampanha", x.id_contato);
      }
      for (const x of tx.onde("Vacina", (k) => idsAnimais.includes(k.id_animal))) {
        tx.excluir("Vacina", x.id_vacina);
      }
      for (const x of tx.onde("CampoValor", (k) => idsAt.includes(k.id_atendimento))) {
        tx.excluir("CampoValor", { id_atendimento: x.id_atendimento, id_campo: x.id_campo });
      }
      for (const x of tx.onde("Aditamento", (k) => idsAt.includes(k.id_atendimento))) {
        tx.excluir("Aditamento", x.id_aditamento);
      }
      for (const x of atendimentos) tx.excluir("Atendimento", x.id_atendimento);
      for (const idAnimal of idsAnimais) tx.excluir("Animal", idAnimal);
      tx.excluir("Tutor", id);
      resultado = "eliminado_por_completo";
    }
    R.auditar(ctx, "ALTERAR", "Titular", id, "eliminacao", null, `${resultado}: ${motivo}`);
    return { status: 200, corpo: { resultado, atendimentos_encerrados_mantidos: encerrados,
      nome_mantido: !!encerrados && tutor.nome !== null } };
  }

  R.ROTAS.push(
    { m: "GET", r: /^\/api\/titular\/([^/]+)\/dados$/, perfis: ["ADMIN"], grava: true,
      h: dadosDoTitular },
    { m: "POST", r: /^\/api\/titular\/([^/]+)\/eliminar$/, perfis: ["ADMIN"], grava: true,
      h: eliminar },
  );
})(RoniVet);


/* ---- 70_rotas.js ---- */
/* Roteador: autenticação, perfis e despacho (design 1).
 *
 * `criarApi({ repo, amb, config })` devolve:
 *   tratar(envelope)  -> { status, corpo }
 *
 * amb:    { agora(), novoId(), sha256(conteudo), paraBase64(conteudo), documentos }
 * config: { permitirLoginTeste }  ("fake:<email>" é a credencial usada pelo aparelho) */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};
RoniVet.ROTAS = RoniVet.ROTAS || [];

(function (R) {
  "use strict";

  const V = R.validar;
  const PUBLICA = "publica";
  const CONTA = "conta";

  // ---------- rotas do próprio roteador ----------

  function login(ctx) {
    const c = ctx.req.corpo || {};
    const email = R.verificarCredencial(ctx.config, ctx.req.credencial || c.credential);
    const usuario = R.usuarioAtivo(ctx.repo, email);
    if (!usuario) throw R.erro(403, "conta não autorizada");
    return { status: 200, corpo: R.usuarioPublico(usuario) };
  }

  const me = (ctx) => ({ status: 200, corpo: R.usuarioPublico(ctx.usuario) });
  const logout = () => ({ status: 200, corpo: { status: "ok" } });
  const saude = () => ({ status: 200, corpo: { status: "ok" } });

  // ---------- usuários autorizados (somente administrador) ----------

  const usuarioLinha = (u) => ({ email: u.email, nome: u.nome, perfil: u.perfil, crmv: u.crmv,
    ativo: u.ativo });

  function listarUsuarios(ctx) {
    return { status: 200, corpo: ctx.tx.todos("Usuario").map(usuarioLinha) };
  }

  function exigirCrmv(perfil, crmv) {
    if (perfil === "VETERINARIO" && !(crmv || "").trim()) {
      throw R.erro(422, { codigo: "crmv_obrigatorio", mensagem: "Veterinário exige o CRMV." });
    }
  }

  function criarUsuario(ctx) {
    const { tx } = ctx;
    const c = V.objeto(ctx.req.corpo);
    const email = V.preenchido(c, "email").toLowerCase();
    if (!email.includes("@")) throw V.invalido("email", "e-mail inválido");
    const nome = V.preenchido(c, "nome");
    const perfil = V.opcao(V.textoObrigatorio(c, "perfil"), "perfil",
      ["ADMIN", "VETERINARIO", "SECRETARIA"]);
    const crmv = R.txt(V.textoOpcional(c, "crmv"));
    exigirCrmv(perfil, crmv);
    if (tx.obter("Usuario", email)) {
      throw R.erro(409, { codigo: "usuario_existente", mensagem: "Já existe um usuário com este e-mail." });
    }
    tx.inserir("Usuario", { email, nome, perfil, crmv, ativo: "SIM" });
    R.auditar(ctx, "CRIAR", "Usuario", email);
    return { status: 201, corpo: usuarioLinha(tx.obter("Usuario", email)) };
  }

  function atualizarUsuario(ctx) {
    const { tx } = ctx;
    const email = ctx.req.params[0].toLowerCase();
    const atual = tx.obter("Usuario", email);
    if (!atual) throw R.erro(404, "usuário não encontrado");
    const c = V.objeto(ctx.req.corpo);
    const novo = { nome: atual.nome, perfil: atual.perfil, crmv: atual.crmv, ativo: atual.ativo };
    if (V.tem(c, "nome")) novo.nome = V.preenchido(c, "nome");
    if (V.tem(c, "perfil")) novo.perfil = V.opcao(c.perfil, "perfil", ["ADMIN", "VETERINARIO", "SECRETARIA"]);
    if (V.tem(c, "crmv")) novo.crmv = R.txt(V.textoOpcional(c, "crmv"));
    if (V.tem(c, "ativo")) novo.ativo = V.opcao(c.ativo, "ativo", ["SIM", "NAO"]);
    exigirCrmv(novo.perfil, novo.crmv);
    const eraAdminAtivo = atual.perfil === "ADMIN" && atual.ativo === "SIM";
    const continuaAdminAtivo = novo.perfil === "ADMIN" && novo.ativo === "SIM";
    if (eraAdminAtivo && !continuaAdminAtivo) {
      const outros = tx.todos("Usuario").filter((u) => u.email !== email
        && u.perfil === "ADMIN" && u.ativo === "SIM");
      if (!outros.length) {
        throw R.erro(409, { codigo: "ultimo_administrador",
          mensagem: "Deve existir ao menos um administrador ativo." });
      }
    }
    for (const [campo, valor] of Object.entries(novo)) {
      if (atual[campo] !== valor) {
        tx.atualizar("Usuario", email, { [campo]: valor });
        R.auditar(ctx, "ALTERAR", "Usuario", email, campo, atual[campo], valor);
      }
    }
    const antes = atual.ativo === "SIM" ? atual.perfil : null;
    const depois = novo.ativo === "SIM" ? novo.perfil : null;
    return { status: 200, corpo: usuarioLinha(tx.obter("Usuario", email)) };
  }

  // ---------- auditoria e integridade ----------

  function listarAuditoria(ctx) {
    const q = ctx.req.query;
    let limite = 200;
    if (q.limite !== undefined) {
      limite = Number(q.limite);
      if (!Number.isInteger(limite) || limite < 1 || limite > 1000) {
        throw V.invalido("limite", "Input should be between 1 and 1000");
      }
    }
    const linhas = ctx.tx.todos("Auditoria").map((a, i) => ({ a, i }))
      .filter(({ a }) => (!q.entidade || a.entidade === q.entidade)
        && (!q.id_entidade || a.id_entidade === q.id_entidade)
        && (!q.usuario || a.usuario_email === q.usuario)
        && (!q.acao || a.acao === q.acao)
        && (!q.de || a.data_hora.slice(0, 10) >= q.de)
        && (!q.ate || a.data_hora.slice(0, 10) <= q.ate))
      .sort((x, y) => (x.a.data_hora < y.a.data_hora ? 1 : (x.a.data_hora > y.a.data_hora ? -1
        : y.i - x.i)));
    return { status: 200, corpo: linhas.slice(0, limite).map(({ a }) => a) };
  }

  /** Confere, para cada atendimento encerrado, o selo dos dados e o hash do documento. */
  function verificarIntegridade(ctx) {
    const { tx, amb, repo } = ctx;
    const divergentes = [];
    let total = 0;
    for (const at of tx.todos("Atendimento")) {
      if (at.status !== "ENCERRADO") continue;
      total += 1;
      const valores = R.valoresDoAtendimento(tx, at.id_atendimento);
      const motivos = [];
      if (!at.selo_integridade || R.seloDoAtendimento(amb, at, valores) !== at.selo_integridade) {
        motivos.push("dados_alterados");
      }
      const conteudo = at.arquivo_pdf ? repo.lerArquivo(at.arquivo_pdf) : null;
      // Aparelho: o arquivo vive no Drive e é conferido ao abri-lo; aqui só os dados.
      const noDrive = amb.documentoPosterior === true && !conteudo
        && (at.documento_estado === "PENDENTE" || at.documento_estado === "GERADO"
          || at.documento_nome);
      if (noDrive) { /* sem arquivo local por desenho */ }
      else if (conteudo === null) motivos.push("documento_ausente");
      else if (amb.sha256(conteudo) !== at.hash_sha256) motivos.push("documento_alterado");
      if (motivos.length) divergentes.push({ id: at.id_atendimento, motivos });
    }
    return { status: 200, corpo: { ok: divergentes.length === 0, total, divergentes } };
  }

  // ---------- tabela de rotas do roteador ----------

  R.ROTAS.push(
    { m: "POST", r: /^\/api\/auth\/login$/, perfis: PUBLICA, grava: false, h: login },
    { m: "GET", r: /^\/api\/auth\/me$/, perfis: null, grava: false, h: me },
    { m: "POST", r: /^\/api\/auth\/logout$/, perfis: PUBLICA, grava: false, h: logout },
    { m: "GET", r: /^\/api\/health$/, perfis: PUBLICA, grava: false, h: saude },
    { m: "GET", r: /^\/api\/usuarios$/, perfis: ["ADMIN"], grava: false, h: listarUsuarios },
    { m: "POST", r: /^\/api\/usuarios$/, perfis: ["ADMIN"], grava: true, h: criarUsuario },
    { m: "PATCH", r: /^\/api\/usuarios\/([^/]+)$/, perfis: ["ADMIN"], grava: true,
      h: atualizarUsuario },
    { m: "GET", r: /^\/api\/auditoria$/, perfis: ["ADMIN"], grava: false, h: listarAuditoria },
    { m: "GET", r: /^\/api\/integridade$/, perfis: ["ADMIN"], grava: false,
      h: verificarIntegridade },
  );

  // ---------- roteador ----------

  function parseCaminho(caminho) {
    const [path, qs] = String(caminho).split("?");
    const query = {};
    if (qs) {
      for (const par of qs.split("&")) {
        if (!par) continue;
        const i = par.indexOf("=");
        const dec = (s) => decodeURIComponent(s.replace(/\+/g, " "));
        query[dec(i < 0 ? par : par.slice(0, i))] = i < 0 ? "" : dec(par.slice(i + 1));
      }
    }
    return { path, query };
  }

  R.criarApi = function criarApi({ repo, amb, config }) {
    const cfg = config || {};

    function tratarInterno(env) {
      if (!env || typeof env !== "object" || typeof env.metodo !== "string"
        || typeof env.caminho !== "string") {
        throw R.erro(422, "envelope inválido");
      }
      const metodo = env.metodo.toUpperCase();
      const { path, query } = parseCaminho(env.caminho);

      let achada = null;
      let caminhoExiste = false;
      for (const rota of R.ROTAS) {
        const m = rota.r.exec(path);
        if (!m) continue;
        caminhoExiste = true;
        if (rota.m === metodo) { achada = { rota, params: m.slice(1).map(decodeURIComponent) }; break; }
      }
      if (!achada) throw R.erro(caminhoExiste ? 405 : 404, caminhoExiste ? "Method Not Allowed" : "Not Found");

      const { rota, params } = achada;
      const req = { metodo, caminho: path, query, params, corpo: env.corpo === undefined ? {} : env.corpo,
        idOp: env.idOp || null, credencial: env.credencial || null };
      const ctx = { amb, repo, config: cfg, req, usuario: null, email: null, tx: null };

      if (rota.perfis !== PUBLICA) {
        const email = R.verificarCredencial(cfg, req.credencial);
        const usuario = R.usuarioAtivo(repo, email);
        ctx.email = email;
        if (rota.perfis === CONTA) {
          ctx.usuario = usuario;   // pode ser null: conta Google ainda sem acesso (convite)
        } else {
          if (!usuario) throw R.erro(401, "usuário não autorizado");
          if (rota.perfis && !rota.perfis.includes(usuario.perfil)) {
            throw R.erro(403, "perfil sem permissão");
          }
          ctx.usuario = usuario;
        }
      }

      const grava = typeof rota.grava === "function" ? rota.grava(req) : rota.grava;
      if (grava) {
        return R.executarGravacao(repo, amb,
          { idOp: req.idOp, usuarioEmail: ctx.email },
          (tx) => rota.h({ ...ctx, tx }));
      }
      return R.executarLeitura(repo, (tx) => rota.h({ ...ctx, tx }));
    }

    function tratar(env) {
      try {
        return tratarInterno(env);
      } catch (e) {
        if (e instanceof R.ProcessoInterrompido) throw e;
        if (e instanceof R.HttpErro) return { status: e.status, corpo: { detail: e.detail } };
        if (typeof console !== "undefined" && console.error) console.error(e);
        return { status: 500, corpo: { detail: "erro interno" } };
      }
    }

    return { tratar };
  };
})(RoniVet);

