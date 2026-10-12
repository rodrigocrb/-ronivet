"use strict";
// Registro de operações e motor de replicação do aparelho (design 2, 3, 4).
//
// O estado do aparelho é a dobra, em ordem total, de todas as operações conhecidas sobre o
// estado-base. Cada operação é executada pelo roteador do núcleo com ambiente determinístico;
// a ordem é (tempo, contador, aparelho) de um relógio lógico híbrido. Chegando uma operação
// anterior a outras já aplicadas, o estado é reconstruído a partir de um ponto de controle.
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.RoniRegistro = api;
})(typeof self !== "undefined" ? self : this, function () {
  const PREFIXO_OP = "registro/op/";
  const ARQ_ESTADO = "registro/estado";
  const ARQ_BASE = "registro/base";
  const ARQ_RESOLVIDOS = "registro/resolvidos";

  // ---------- relógio lógico híbrido e ordem total ----------

  /** Compara (tempo, contador, aparelho); devolve -1, 0 ou 1. */
  function compararOrdem(a, b) {
    if (a.t !== b.t) return a.t < b.t ? -1 : 1;
    if (a.c !== b.c) return a.c < b.c ? -1 : 1;
    if (a.aparelho === b.aparelho) return 0;
    return a.aparelho < b.aparelho ? -1 : 1;
  }

  /** `estado` {t, c} é alterado no lugar; `agoraMs` é o relógio do aparelho. */
  function criarRelogio({ aparelho, agoraMs, estado }) {
    const e = estado || { t: 0, c: 0 };
    return {
      estado: () => ({ t: e.t, c: e.c }),
      /** Marca de uma nova operação local: sempre maior que tudo que o aparelho já viu. */
      emitir() {
        const fisico = Math.floor(agoraMs());
        if (fisico > e.t) { e.t = fisico; e.c = 0; } else { e.c += 1; }
        return { t: e.t, c: e.c, aparelho };
      },
      /** Absorve a marca de uma operação recebida (o tempo visto nunca regride). */
      observar(marca) {
        if (marca.t > e.t || (marca.t === e.t && marca.c > e.c)) { e.t = marca.t; e.c = marca.c; }
      },
    };
  }

  // ---------- motor ----------

  /**
   * opcoes: { R, repo, amb, api, aparelho, agoraMs(), pontoDeControleCada }
   * `repo` é o repositório local (com exportarTudo/substituirTudo/descarregar).
   */
  async function criarMotor(opcoes) {
    const { R, repo, amb, api, aparelho } = opcoes;
    const agoraMs = opcoes.agoraMs || (() => Date.now());
    const cada = opcoes.pontoDeControleCada || 25;

    const estadoSalvo = repo.existeArquivo(ARQ_ESTADO) ? JSON.parse(repo.lerArquivo(ARQ_ESTADO)) : {};
    const relogio = criarRelogio({ aparelho, agoraMs, estado: estadoSalvo.hlc });
    let contadorIds = estadoSalvo.contadorIds || 0;
    // Ponto de corte: as operações com marca <= corte já estão dentro do estado-base
    // (instantâneo recebido ao entrar na clínica) e não são reaplicadas.
    let corte = estadoSalvo.corte || null;

    if (!repo.existeArquivo(ARQ_BASE)) {
      repo.gravarArquivo(ARQ_BASE, JSON.stringify(repo.exportarTudo()));
    }

    /** id -> { op, estado: "aplicada"|"recusada", motivo, publicada } */
    const registros = new Map();
    for (const caminho of repo.listarArquivos()) {
      if (!caminho.startsWith(PREFIXO_OP)) continue;
      const r = JSON.parse(repo.lerArquivo(caminho));
      registros.set(r.op.id, r);
    }
    // Conferência de conflitos: marca local do aparelho (não altera dados nem a ordem).
    const resolvidos = repo.existeArquivo(ARQ_RESOLVIDOS)
      ? JSON.parse(repo.lerArquivo(ARQ_RESOLVIDOS)) : {};
    let ordem = [...registros.values()].map((r) => r.op).sort(compararOrdem);
    let pontos = [];   // [{ indice, tabelas }]: estado depois de aplicar as `indice` primeiras

    const salvarEstado = () => repo.gravarArquivo(ARQ_ESTADO,
      JSON.stringify({ hlc: relogio.estado(), contadorIds, corte }));
    const salvarRegistro = (r) => repo.gravarArquivo(PREFIXO_OP + r.op.id, JSON.stringify(r));

    function executar(op, alvo = { amb, api }) {
      return alvo.amb.executarComo({ idOp: op.id, hora: op.hora, aparelho: op.aparelho }, () => alvo.api.tratar({
        metodo: op.metodo, caminho: op.caminho, corpo: op.corpo, idOp: op.id,
        credencial: `fake:${op.email}` }));
    }

    function classificar(resposta) {
      if (resposta.status >= 400) {
        const d = resposta.corpo && resposta.corpo.detail;
        return { estado: "recusada",
          motivo: { status: resposta.status, detalhe: d === undefined ? null : d } };
      }
      return { estado: "aplicada", motivo: null };
    }

    function ponto(indice) {
      if (indice > 0 && indice % cada === 0) {
        pontos.push({ indice, tabelas: repo.exportarTudo() });
      }
    }

    /**
     * Reaplica, a partir do ponto de controle anterior a `posicao`, todas as operações da ordem.
     * Devolve a lista de operações cujo resultado mudou de estado.
     */
    function reconstruir(posicao) {
      pontos = pontos.filter((p) => p.indice <= posicao);
      const base = pontos.length ? pontos[pontos.length - 1] : null;
      const inicio = base ? base.indice : 0;
      const tabelas = base ? base.tabelas : JSON.parse(repo.lerArquivo(ARQ_BASE));
      repo.substituirTudo(R.clonar(tabelas));
      const mudaram = [];
      for (let i = inicio; i < ordem.length; i += 1) {
        const op = ordem[i];
        const r = registros.get(op.id);
        const c = classificar(executar(op));
        if (r.estado !== c.estado || JSON.stringify(r.motivo) !== JSON.stringify(c.motivo)) {
          mudaram.push({ id: op.id, de: r.estado, para: c.estado, motivo: c.motivo });
          r.estado = c.estado;
          r.motivo = c.motivo;
          salvarRegistro(r);
        }
        ponto(i + 1);
      }
      return mudaram;
    }

    const motor = {
      aparelho,

      /** Identificador de operação novo e único deste aparelho. */
      novoIdOp() {
        contadorIds += 1;
        return `${aparelho}-${agoraMs().toString(36)}-${contadorIds.toString(36)}`;
      },

      /**
       * Executa uma requisição no aparelho. Se ela produziu efeitos, entra no registro como
       * operação (resultado provisório até a ordem total ser conhecida).
       * env: { metodo, caminho, corpo, idOp, credencial, hora }
       */
      executarLocal(env) {
        const idOp = env.idOp || motor.novoIdOp();
        const email = String(env.credencial || "").startsWith("fake:")
          ? env.credencial.slice(5) : null;
        const antes = repo.aplicadasAteAgora();
        const resposta = amb.executarComo({ idOp, hora: env.hora, aparelho }, () => api.tratar({
          metodo: env.metodo, caminho: env.caminho, corpo: env.corpo, idOp: env.idOp || idOp,
          credencial: env.credencial, versaoApp: env.versaoApp }));
        if (repo.aplicadasAteAgora() === antes || !email || registros.has(idOp)) return resposta;

        const corpo = env.corpo && typeof env.corpo === "object" ? { ...env.corpo } : env.corpo;
        if (corpo && typeof corpo === "object") delete corpo.credential;
        const marca = relogio.emitir();
        const op = { id: idOp, ...marca, aparelho, hora: env.hora, email,
          metodo: env.metodo, caminho: env.caminho, corpo: corpo === undefined ? null : corpo };
        const c = classificar(resposta);
        const r = { op, estado: c.estado, motivo: c.motivo, publicada: false };
        registros.set(idOp, r);
        ordem.push(op);   // a marca emitida é maior que todas as conhecidas: vai ao fim
        ponto(ordem.length);
        salvarRegistro(r);
        salvarEstado();
        return resposta;
      },

      /**
       * Recebe operações de outros aparelhos. Devolve { novas, reconstruiu, mudaram }.
       * Não grava de forma durável: o chamador usa repo.descarregar().
       */
      receber(operacoes) {
        const novas = [];
        for (const op of operacoes) {
          if (!op || typeof op.id !== "string" || registros.has(op.id)) continue;
          if (typeof op.t !== "number" || typeof op.c !== "number" || !op.aparelho
            || !op.email || !op.metodo || !op.caminho) continue;
          if (corte && compararOrdem(op, corte) <= 0) continue;   // já está no estado-base
          novas.push(op);
        }
        if (!novas.length) return { novas: 0, reconstruiu: false, mudaram: [] };
        novas.sort(compararOrdem);
        for (const op of novas) relogio.observar(op);

        const ultimo = ordem.length ? ordem[ordem.length - 1] : null;
        const noFim = !ultimo || compararOrdem(novas[0], ultimo) > 0;
        for (const op of novas) {
          registros.set(op.id, { op, estado: "aplicada", motivo: null, publicada: true });
        }
        const mudaram = [];
        let reconstruiu = false;
        if (noFim) {
          for (const op of novas) {
            ordem.push(op);
            const r = registros.get(op.id);
            const c = classificar(executar(op));
            r.estado = c.estado;
            r.motivo = c.motivo;
            salvarRegistro(r);
            ponto(ordem.length);
          }
        } else {
          ordem = [...ordem, ...novas].sort(compararOrdem);
          const posicao = Math.min(...novas.map((o) => ordem.indexOf(o)));
          for (const op of novas) salvarRegistro(registros.get(op.id));
          mudaram.push(...reconstruir(posicao));
          reconstruiu = true;
        }
        salvarEstado();
        return { novas: novas.length, reconstruiu, mudaram };
      },

      /**
       * Estado (todas as tabelas) depois de aplicar as operações com marca <= `ate`, calculado
       * em um repositório isolado, sem mexer no estado vivo. `isolado()` cria { repo, amb, api }.
       */
      estadoAte(ate) {
        if (!opcoes.isolado) throw new Error("motor sem fábrica de ambiente isolado");
        const alvo = opcoes.isolado();
        alvo.repo.substituirTudo(JSON.parse(repo.lerArquivo(ARQ_BASE)));
        for (const op of ordem) {
          if (compararOrdem(op, ate) > 0) break;
          executar(op, alvo);
        }
        return alvo.repo.exportarTudo();
      },

      /**
       * Promessa de ordem: avança o relógio e devolve a marca; toda operação futura deste
       * aparelho será maior que ela (mesmo que o relógio físico volte).
       */
      prometer() {
        const m = relogio.emitir();
        salvarEstado();
        return m;
      },

      /** Ponto de corte atual (marca) ou null. */
      corte: () => (corte ? { ...corte } : null),

      /**
       * O estado atual passa a ser o estado-base (importação do sistema anterior). Só vale
       * antes de qualquer operação registrada ou instantâneo adotado.
       */
      adotarComoBase() {
        if (registros.size || corte) throw new Error("o aparelho já tem operações registradas");
        repo.gravarArquivo(ARQ_BASE, JSON.stringify(repo.exportarTudo()));
        pontos = [];
      },

      /** Aparelho novo: adota um instantâneo como estado-base. Só com o registro vazio. */
      iniciarDeInstantaneo({ tabelas, ate }) {
        if (registros.size) throw new Error("o aparelho já tem operações registradas");
        repo.gravarArquivo(ARQ_BASE, JSON.stringify(tabelas));
        repo.substituirTudo(R.clonar(tabelas));
        corte = { t: ate.t, c: ate.c, aparelho: ate.aparelho };
        relogio.observar(ate);
        ordem = [];
        pontos = [];
        salvarEstado();
      },

      /** Operações locais ainda não publicadas, na ordem total. */
      pendentesDeEnvio() {
        return ordem.filter((o) => o.aparelho === aparelho && !registros.get(o.id).publicada);
      },

      marcarPublicadas(ids) {
        for (const id of ids) {
          const r = registros.get(id);
          if (r && !r.publicada) { r.publicada = true; salvarRegistro(r); }
        }
      },

      /** Todas as operações conhecidas, na ordem total, com o resultado na ordem. */
      operacoes() {
        return ordem.map((o) => {
          const r = registros.get(o.id);
          return { ...o, estado: r.estado, motivo: r.motivo };
        });
      },

      recusadas() { return motor.operacoes().filter((o) => o.estado === "recusada"); },

      /**
       * Conflitos para conferência: operações recusadas na ordem total, com quem fez, onde e
       * por quê. `incluirResolvidos` traz também os já conferidos (o registro nunca se perde).
       */
      conflitos({ incluirResolvidos = false } = {}) {
        return motor.recusadas()
          .map((o) => ({ id: o.id, aparelho: o.aparelho, pessoa: o.email, hora: o.hora,
            metodo: o.metodo, caminho: o.caminho, corpo: o.corpo, motivo: o.motivo,
            resolvido: Boolean(resolvidos[o.id]), resolvidoEm: resolvidos[o.id] || null }))
          .filter((c) => incluirResolvidos || !c.resolvido);
      },

      /** Marca um conflito como conferido; o registro da operação permanece. */
      resolverConflito(id, quando) {
        if (!registros.has(id) || registros.get(id).estado !== "recusada") return false;
        resolvidos[id] = quando || new Date(agoraMs()).toISOString();
        repo.gravarArquivo(ARQ_RESOLVIDOS, JSON.stringify(resolvidos));
        return true;
      },
      relogio: () => relogio.estado(),
      totalDeOperacoes: () => ordem.length,
    };

    // O estado persistido já reflete todas as operações do registro (mesma transação).
    return motor;
  }

  return { criarMotor, criarRelogio, compararOrdem };
});
