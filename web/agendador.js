"use strict";
// Agendador da sincronização (design 5, spec "Sincronização automática e manual"): ciclo a cada
// 5 minutos, ciclo imediato depois de registrar uma operação, recuo exponencial em falhas e um
// estado simples para a interface. Os temporizadores são injetados (testes e navegador).
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.RoniAgendador = api;
})(typeof self !== "undefined" ? self : this, function () {
  const CINCO_MINUTOS = 5 * 60 * 1000;
  const RECUO_MAXIMO = 30 * 60 * 1000;

  /**
   * opcoes: { sincronizar() -> resultado, pendentes() -> n, online() -> bool, timers: {set, clear},
   *           intervaloMs, aoMudar(estado) }
   * Estados: "sincronizando" | "sincronizado" | "pendente" | "sem_conexao" | "erro" | "pausada".
   */
  function criarAgendador(opcoes) {
    const { sincronizar, pendentes, timers } = opcoes;
    const online = opcoes.online || (() => true);
    const intervalo = opcoes.intervaloMs || CINCO_MINUTOS;
    let estado = "sincronizado";
    let ultimo = null;
    let falhasSeguidas = 0;
    let marcador = null;
    let rodando = false;
    let repetir = false;
    let ativo = false;

    function mudar(novo) {
      if (novo === estado) return;
      estado = novo;
      if (opcoes.aoMudar) opcoes.aoMudar(novo);
    }
    const agendar = (ms) => {
      if (marcador !== null) timers.clear(marcador);
      marcador = ativo ? timers.set(() => { marcador = null; executar(); }, ms) : null;
    };
    const recuo = () => Math.min(RECUO_MAXIMO, intervalo * (2 ** Math.max(0, falhasSeguidas - 1)));

    async function executar() {
      if (rodando) { repetir = true; return ultimo; }
      if (!online()) {
        mudar("sem_conexao");
        agendar(intervalo);
        return ultimo;
      }
      rodando = true;
      mudar("sincronizando");
      try {
        ultimo = await sincronizar();
        const erros = ultimo.erros || [];
        if (!erros.length) {
          falhasSeguidas = 0;
          mudar(pendentes() > 0 ? "pendente" : "sincronizado");
        } else if (erros.some((e) => e.codigo === "autorizacao")) {
          mudar("pausada");
        } else {
          falhasSeguidas += 1;
          mudar("erro");
        }
      } catch (e) {
        ultimo = { erros: [{ motivo: String(e && e.message || e) }] };
        falhasSeguidas += 1;
        mudar("erro");
      } finally {
        rodando = false;
      }
      if (repetir) { repetir = false; agendar(0); } else {
        agendar(estado === "erro" ? recuo() : intervalo);
      }
      return ultimo;
    }

    return {
      /** Começa os ciclos periódicos (o primeiro, já). */
      iniciar() { ativo = true; agendar(0); },
      parar() { ativo = false; if (marcador !== null) { timers.clear(marcador); marcador = null; } },
      /** Pedido imediato (depois de registrar uma operação ou pelo botão); junta pedidos. */
      solicitar() { return executar(); },
      estado: () => estado,
      ultimoResultado: () => ultimo,
      falhasSeguidas: () => falhasSeguidas,
      proximoRecuo: recuo,
    };
  }

  return { criarAgendador, CINCO_MINUTOS };
});
