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
