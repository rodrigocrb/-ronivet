"use strict";
// Repositório local do aparelho (design 9): as tabelas ficam em memória (a interface do
// Repositorio é síncrona) e cada operação é gravada de uma vez, em uma única transação, no
// armazenamento durável (IndexedDB) antes de ser confirmada ao usuário. Uma interrupção antes
// de `descarregar()` deixa o banco como estava, nunca com a operação pela metade.
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.RoniRepositorioLocal = api;
})(typeof self !== "undefined" ? self : this, function () {
  const SEP = "\u0000";

  // ---------- armazenamento durável (porta) ----------
  // carregar() -> { linhas: [{k, tabela, seq, linha}], arquivos: [{k, conteudo}] }
  // gravar({ linhas: [...], removerLinhas: [k], arquivos: [...], removerArquivos: [k] })

  /** Armazenamento em memória (testes; aceita falha injetada). */
  function armazenamentoMemoria() {
    const linhas = new Map();
    const arquivos = new Map();
    const copia = (v) => (v === undefined ? v : structuredClone(v));
    return {
      falharProximaGravacao: false,
      async carregar() {
        return { linhas: [...linhas.values()].map(copia),
          arquivos: [...arquivos.entries()].map(([k, conteudo]) => ({ k, conteudo })) };
      },
      async gravar(lote) {
        if (this.falharProximaGravacao) {
          this.falharProximaGravacao = false;
          throw new Error("falha de gravação (simulada)");
        }
        for (const l of lote.linhas) linhas.set(l.k, copia(l));
        for (const k of lote.removerLinhas) linhas.delete(k);
        for (const a of lote.arquivos) arquivos.set(a.k, a.conteudo);
        for (const k of lote.removerArquivos) arquivos.delete(k);
      },
      async apagarTudo() { linhas.clear(); arquivos.clear(); },
    };
  }

  /** Armazenamento em IndexedDB: uma transação por lote (tudo ou nada). */
  function armazenamentoIndexedDB(indexedDB, nome = "ronivet-local") {
    let abertura = null;
    const aberto = () => abertura || (abertura = new Promise((resolve, reject) => {
      const req = indexedDB.open(nome, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore("linhas", { keyPath: "k" });
        db.createObjectStore("arquivos", { keyPath: "k" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
    const pedido = (req) => new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return {
      async carregar() {
        const db = await aberto();
        const t = db.transaction(["linhas", "arquivos"], "readonly");
        const [linhas, arquivos] = await Promise.all([
          pedido(t.objectStore("linhas").getAll()), pedido(t.objectStore("arquivos").getAll())]);
        return { linhas, arquivos };
      },
      async gravar(lote) {
        const db = await aberto();
        await new Promise((resolve, reject) => {
          const t = db.transaction(["linhas", "arquivos"], "readwrite");
          const l = t.objectStore("linhas");
          const a = t.objectStore("arquivos");
          for (const x of lote.linhas) l.put(x);
          for (const k of lote.removerLinhas) l.delete(k);
          for (const x of lote.arquivos) a.put(x);
          for (const k of lote.removerArquivos) a.delete(k);
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error || new Error("transação abortada"));
        });
      },
      async apagarTudo() {
        const db = await aberto();
        await new Promise((resolve, reject) => {
          const t = db.transaction(["linhas", "arquivos"], "readwrite");
          t.objectStore("linhas").clear();
          t.objectStore("arquivos").clear();
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error || new Error("transação abortada"));
        });
      },
    };
  }

  // ---------- repositório ----------

  /**
   * `R`: o núcleo (nucleo.js). `armazenamento`: uma das portas acima.
   * Devolve (Promise) um repositório com a interface do núcleo mais `descarregar()`.
   */
  async function criarRepositorioLocal({ R, armazenamento }) {
    const base = R.criarRepositorioMemoria();
    const carregado = await armazenamento.carregar();

    const sequencias = new Map();   // k -> ordem de inserção (para restaurar a ordem das linhas)
    let proxima = 1;
    const porTabela = new Map();
    for (const item of carregado.linhas) {
      if (!porTabela.has(item.tabela)) porTabela.set(item.tabela, []);
      porTabela.get(item.tabela).push(item);
      sequencias.set(item.k, item.seq);
      proxima = Math.max(proxima, item.seq + 1);
    }
    for (const [tabela, itens] of porTabela) {
      itens.sort((a, b) => a.seq - b.seq);
      base.aplicar(itens.map((i) => ({ tabela, tipo: "inserir", linha: i.linha })));
    }
    for (const a of carregado.arquivos) base.gravarArquivo(a.k, a.conteudo);

    const tocadas = new Map();      // k -> { tabela, chave }
    const arquivosTocados = new Set();

    const chaveTexto = (tabela, chave) => tabela + SEP
      + R.TABELAS[tabela].chave.map((c) => String(chave[c])).join(SEP);

    function marcar(m) {
      const chave = m.tipo === "inserir" ? R.chaveDaLinha(m.tabela, m.linha) : m.chave;
      const k = chaveTexto(m.tabela, chave);
      if (!tocadas.has(k)) tocadas.set(k, { tabela: m.tabela, chave });
    }

    const repo = Object.create(base);
    repo.aplicar = function aplicar(mutacoes, opcoes) {
      for (const m of mutacoes) marcar(m);   // marca antes: uma aplicação parcial também é gravada
      return base.aplicar(mutacoes, opcoes);
    };
    repo.gravarArquivo = (caminho, conteudo) => {
      arquivosTocados.add(caminho);
      base.gravarArquivo(caminho, conteudo);
    };
    repo.excluirArquivo = (caminho) => {
      arquivosTocados.add(caminho);
      base.excluirArquivo(caminho);
    };

    /** Troca todo o estado (reconstrução): reatribui a ordem das linhas e grava tudo. */
    repo.substituirTudo = function substituirTudo(estado) {
      const antigas = base.exportarTudo();
      for (const [tabela, linhas] of Object.entries(antigas)) {
        for (const linha of linhas) marcar({ tabela, tipo: "inserir", linha });
      }
      base.substituirTudo(estado);
      for (const [tabela, linhas] of Object.entries(base.exportarTudo())) {
        for (const linha of linhas) {
          marcar({ tabela, tipo: "inserir", linha });
          sequencias.set(chaveTexto(tabela, R.chaveDaLinha(tabela, linha)), proxima);
          proxima += 1;
        }
      }
    };

    /** Grava, em uma transação, o estado final de tudo que mudou desde a última gravação. */
    repo.descarregar = async function descarregar() {
      if (apagado) return;
      if (!tocadas.size && !arquivosTocados.size) return;
      const lote = { linhas: [], removerLinhas: [], arquivos: [], removerArquivos: [] };
      const tabelas = new Map();
      const novas = [];
      for (const [k, { tabela, chave }] of tocadas) {
        if (!tabelas.has(tabela)) tabelas.set(tabela, base.ler(tabela));
        const linha = tabelas.get(tabela).find((l) => R.TABELAS[tabela].chave
          .every((c) => String(l[c]) === String(chave[c])));
        if (linha) {
          let seq = sequencias.get(k);
          if (seq === undefined) { seq = proxima; novas.push([k, seq]); }
          lote.linhas.push({ k, tabela, seq, linha });
        } else {
          lote.removerLinhas.push(k);
        }
      }
      for (const caminho of arquivosTocados) {
        if (base.existeArquivo(caminho)) {
          lote.arquivos.push({ k: caminho, conteudo: base.lerArquivo(caminho) });
        } else {
          lote.removerArquivos.push(caminho);
        }
      }
      await armazenamento.gravar(lote);   // falhou: continua pendente para a próxima tentativa
      for (const [k, seq] of novas) { sequencias.set(k, seq); proxima = Math.max(proxima, seq + 1); }
      for (const k of lote.removerLinhas) sequencias.delete(k);
      tocadas.clear();
      arquivosTocados.clear();
    };

    /**
     * Apaga todo o banco do aparelho (retirada): o armazenamento durável e a memória. Depois disso
     * nada mais é gravado, para que nada reapareça antes de o aplicativo ser reaberto.
     */
    let apagado = false;
    repo.apagarTudo = async function apagarTudo() {
      apagado = true;
      await armazenamento.apagarTudo();
      for (const c of base.listarArquivos()) base.excluirArquivo(c);
      base.substituirTudo({});
      tocadas.clear();
      arquivosTocados.clear();
    };

    /** Há alterações em memória ainda não gravadas de forma durável? */
    repo.pendenteDeGravacao = () => tocadas.size > 0 || arquivosTocados.size > 0;
    return repo;
  }

  return { criarRepositorioLocal, armazenamentoMemoria, armazenamentoIndexedDB };
});
