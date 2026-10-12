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
