"use strict";
// Cola do modo local com o Drive: conta Google autorizada, cliente do Drive, sincronizador e
// agendador, além do texto de estado e da descrição dos conflitos para a interface.
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.RoniSyncApp = api;
})(typeof self !== "undefined" ? self : this, function () {
  const ROTULO_ESTADO = {
    sincronizando: "Sincronizando…",
    sincronizado: "Sincronizado",
    pendente: "Pendente de envio",
    sem_conexao: "Sem conexão",
    erro: "Erro ao sincronizar",
    pausada: "Conta Google precisa entrar de novo",
    desconectado: "Conta Google não conectada",
  };

  /** Texto curto de uma operação recusada, para a lista de conflitos. */
  function descreverConflito(c) {
    const corpo = c.corpo || {};
    const quando = String(corpo.inicio || "").replace("T", " ").slice(0, 16);
    let o;
    if (/^\/api\/agendamentos$/.test(c.caminho) || /^\/api\/atendimentos$/.test(c.caminho)) {
      const quem = [corpo.animal && corpo.animal.nome, corpo.tutor && corpo.tutor.nome]
        .filter(Boolean).join(" · ");
      o = `Agendamento${quem ? ` de ${quem}` : ""}${quando ? ` em ${quando}` : ""}`;
    } else if (/\/valores$/.test(c.caminho)) {
      o = "Dados do atendimento";
    } else if (/\/encerrar$/.test(c.caminho)) {
      o = "Encerramento do atendimento";
    } else if (/^\/api\/tutores/.test(c.caminho)) {
      o = `Cadastro do tutor${corpo.nome ? ` ${corpo.nome}` : ""}`;
    } else if (/^\/api\/animais/.test(c.caminho)) {
      o = `Cadastro do animal${corpo.nome ? ` ${corpo.nome}` : ""}`;
    } else {
      o = `${c.metodo} ${c.caminho}`;
    }
    const d = c.motivo && c.motivo.detalhe;
    const porque = (d && (d.mensagem || d.codigo)) || (typeof d === "string" ? d : "")
      || "operação recusada";
    return { titulo: o, porque };
  }

  /**
   * deps: { motor, repo, Drive (RoniDriveRest), Raiz (RoniRaiz), Sinc (RoniSincronizacao),
   *         Agendador (RoniAgendador), Ambiente (RoniAmbienteLocal), autorizar(conta) ->
   *         {accessToken,email}, fetchImpl, timers, online(), aparelho, aoMudar(estado) }
   */
  function criarSyncApp(deps) {
    let conta = deps.contaInicial || null;
    let token = null;
    let tokenAte = 0;
    const agora = deps.agoraMs || (() => Date.now());
    let sincronizador = null;
    let agendador = null;

    async function obterToken(renovar) {
      if (!renovar && token && agora() < tokenAte) return token;
      const r = await deps.autorizar(conta);
      token = r.accessToken;
      tokenAte = agora() + 50 * 60 * 1000;   // o token do Google dura cerca de 1 hora
      if (r.email && r.email !== conta) { conta = r.email; if (deps.aoMudarConta) deps.aoMudarConta(conta); }
      return token;
    }

    let fluxo = null;
    let retirado = null;
    let driveAtual = null;

    function montar() {
      // Só o aparelho de origem da clínica pode criar a pasta; os que entraram por instantâneo
      // (ou por pessoa convidada) precisam que ela esteja compartilhada com a conta.
      const drive = deps.Drive.criarClienteDrive({ fetchImpl: deps.fetchImpl, obterToken,
        abrirRaiz: deps.Raiz.abrirRaiz, podeCriarRaiz: () => !deps.motor.corte() });
      driveAtual = drive;
      if (deps.criarFluxo) fluxo = deps.criarFluxo(drive);
      sincronizador = deps.Sinc.criarSincronizador({ motor: deps.motor, repo: deps.repo, drive,
        aparelho: deps.aparelho, sha256: deps.Ambiente.sha256, paraBase64: deps.Ambiente.paraBase64,
        deBase64: deps.Ambiente.deBase64, instantaneoACada: 50,
        nome: () => (deps.nomeAparelho ? deps.nomeAparelho() : undefined),
        aoSerRetirado: async (r) => {
          retirado = r;
          if (agendador) agendador.parar();
          if (deps.aoSerRetirado) await deps.aoSerRetirado(r);
        },
        aposCiclo: async (resultado) => {
          if (!fluxo) return;
          const g = await fluxo.gerarPendentes();
          const l = await fluxo.liberarArquivosLocais();
          resultado.documentos = { gerados: g.gerados, liberados: l.liberados };
          const erros = [...g.erros, ...l.erros];
          if (erros.length) {
            resultado.erros.push({ etapa: "documentos", motivo: erros[0].motivo,
              codigo: erros[0].codigo });
          }
        } });
      agendador = deps.Agendador.criarAgendador({
        sincronizar: () => sincronizador.sincronizar(),
        pendentes: () => deps.motor.pendentesDeEnvio().length,
        online: deps.online || (() => true),
        timers: deps.timers,
        aoMudar: (e) => { if (deps.aoMudar) deps.aoMudar(e); },
      });
    }

    return {
      conta: () => conta,
      conectado: () => Boolean(sincronizador),
      estado: () => (agendador ? agendador.estado() : "desconectado"),
      rotuloEstado() { return ROTULO_ESTADO[this.estado()] || this.estado(); },
      pendentes: () => deps.motor.pendentesDeEnvio().length,
      conflitos: () => deps.motor.conflitos().map((c) => ({ ...c, ...descreverConflito(c) })),
      ultimoResultado: () => (agendador ? agendador.ultimoResultado() : null),
      /**
       * Guarda o modelo .docx (valida, calcula o hash e envia ao Drive se houver conexão).
       * Sem conexão, fica no aparelho e é enviado ao conectar, antes da primeira geração.
       */
      async guardarModelo(bytes) {
        if (fluxo) return fluxo.guardarModelo(bytes);
        const marcadores = await deps.docx.marcadoresDoDocx(bytes);
        const sha = deps.Ambiente.sha256(bytes);
        deps.repo.gravarArquivo(`modelos/${sha}.docx`, bytes);
        await deps.repo.descarregar();
        return { sha, marcadores, referencia: `docx:${sha}:${marcadores.join(",")}`, noDrive: false };
      },
      /** Baixa o PDF do Drive (estado: ok | pendente | ausente | divergente | sem_documento). */
      obterDocumento: (id) => (fluxo ? fluxo.obterBytes(id)
        : Promise.resolve({ estado: "sem_conexao" })),

      /** Autoriza o Drive (abre o consentimento do Google se preciso) e inicia a sincronização. */
      async conectar() {
        await obterToken(true);
        if (!sincronizador) montar();
        // Primeiro aparelho da clínica: publica o estado-base para os demais entrarem por ele.
        try { await sincronizador.publicarBase(); } catch (_) { /* tenta no próximo ciclo */ }
        agendador.iniciar();
        if (deps.aoMudar) deps.aoMudar(agendador.estado());
        return conta;
      },

      /**
       * Identifica a pessoa pela conta Google dela (a mesma que acessa a pasta compartilhada) e
       * deixa a sincronização ativa. `dica`: conta usada da última vez (entrada sem tela).
       * Devolve o e-mail verificado pelo Google.
       */
      async entrarComConta(dica) {
        await this.identificar(dica);
        if (!sincronizador) montar();
        agendador.iniciar();
        return conta;
      },

      /** Só identifica a conta Google (abre o seletor/consentimento); não inicia a sincronização. */
      async identificar(dica) {
        if (dica && dica !== conta) conta = dica;
        token = null;
        await obterToken(true);
        if (!conta) throw new Error("Não foi possível identificar a conta Google.");
        return conta;
      },

      /** Aparelho novo: conecta e adota a clínica compartilhada com esta conta. */
      async entrarNaClinica() {
        await obterToken(true);
        if (!sincronizador) montar();
        if (!(await driveAtual.localizarRaiz())) {
          throw Object.assign(new Error("A pasta da clínica ainda não foi compartilhada com esta "
            + `conta Google (${conta || "?"}). Peça à administração para cadastrá-la em Pessoas.`),
          { codigo: "sem_pasta" });
        }
        const r = await sincronizador.entrar();
        agendador.iniciar();
        return r;
      },

      /** Reconecta em silêncio uma conta já autorizada (ao abrir o aplicativo). */
      async retomar() {
        if (!conta) return false;
        if (!sincronizador) montar();
        agendador.iniciar();
        return true;
      },

      /** Deixa o modelo .docx inicial na pasta da clínica para ser editado fora do celular. */
      async salvarModeloInicial(nome, bytes) {
        if (!driveAtual) return false;
        await driveAtual.gravarBytes(`modelos-iniciais/${nome}`, bytes, { substituir: true,
          tipo: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
        return true;
      },

      /** Compartilhamento da pasta da clínica com as pessoas (convite e revogação pelo Google). */
      compartilhamentos: async () => (driveAtual ? driveAtual.listarCompartilhamentos() : []),
      async compartilharPasta(email) {
        if (!driveAtual) throw new Error("Conecte a conta Google para convidar pessoas.");
        return driveAtual.compartilhar(email);
      },
      async retirarAcesso(email) {
        if (!driveAtual) throw new Error("Conecte a conta Google para retirar o acesso.");
        return driveAtual.deixarDeCompartilhar(email);
      },

      /** Preenchido quando este aparelho foi retirado pela administração. */
      retirado: () => retirado,

      /** Aparelhos da clínica: { id, nome, ativo, esteAparelho, retirada }. Precisa de conexão. */
      async aparelhos() {
        if (!sincronizador) return [];
        const [lista, retirados] = await Promise.all([sincronizador.lerAparelhos(),
          sincronizador.lerRetirados()]);
        const ids = new Set(lista.map((a) => a.aparelho));
        const saida = lista.map((a) => ({ id: a.aparelho, nome: a.nome || a.aparelho,
          ativo: !retirados.has(a.aparelho), esteAparelho: a.aparelho === deps.aparelho,
          retirada: retirados.get(a.aparelho) || null }));
        for (const [id, r] of retirados) {
          if (!ids.has(id)) saida.push({ id, nome: id, ativo: false, esteAparelho: false, retirada: r });
        }
        return saida.sort((x, y) => Number(y.ativo) - Number(x.ativo) || x.nome.localeCompare(y.nome));
      },

      /** Retira um aparelho (perdido ou fora de uso): ele apaga os dados ao sincronizar. */
      async retirarAparelho(id, { por, motivo } = {}) {
        if (!sincronizador) throw new Error("Conecte a conta Google para retirar um aparelho.");
        if (id === deps.aparelho) throw new Error("Este aparelho não pode retirar a si mesmo.");
        return sincronizador.retirar(id, { por, motivo, em: deps.agoraIso ? deps.agoraIso() : null });
      },

      /** Pedido imediato (depois de registrar uma operação ou pelo botão). */
      sincronizarAgora: () => (agendador ? agendador.solicitar() : Promise.resolve(null)),
      parar() { if (agendador) agendador.parar(); },
    };
  }

  return { criarSyncApp, descreverConflito, ROTULO_ESTADO };
});
