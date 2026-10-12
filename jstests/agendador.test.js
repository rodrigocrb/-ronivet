"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { criarAgendador, CINCO_MINUTOS } = require("../web/agendador");

function relogioFalso() {
  let agora = 0;
  let proximo = 1;
  const fila = new Map();
  return {
    timers: {
      set(fn, ms) { const id = proximo++; fila.set(id, { fn, em: agora + ms }); return id; },
      clear(id) { fila.delete(id); },
    },
    agora: () => agora,
    pendentesNaFila: () => fila.size,
    /** Avança o tempo executando os temporizadores vencidos, em ordem. */
    async avancar(ms) {
      const alvo = agora + ms;
      for (;;) {
        const vencidos = [...fila.entries()].filter(([, t]) => t.em <= alvo)
          .sort((a, b) => a[1].em - b[1].em);
        if (!vencidos.length) break;
        const [id, t] = vencidos[0];
        fila.delete(id);
        agora = t.em;
        await t.fn();
        await new Promise((r) => setImmediate(r));
      }
      agora = alvo;
    },
  };
}

test("sincroniza ao iniciar e a cada 5 minutos", async () => {
  const rel = relogioFalso();
  let chamadas = 0;
  const ag = criarAgendador({ timers: rel.timers, sincronizar: async () => { chamadas += 1; return { erros: [] }; },
    pendentes: () => 0 });
  ag.iniciar();
  await rel.avancar(0);
  assert.equal(chamadas, 1);
  await rel.avancar(CINCO_MINUTOS);
  assert.equal(chamadas, 2);
  await rel.avancar(CINCO_MINUTOS * 2);
  assert.equal(chamadas, 4);
  assert.equal(ag.estado(), "sincronizado");
});

test("pedido imediato não espera o intervalo e pedidos simultâneos são juntados", async () => {
  const rel = relogioFalso();
  let chamadas = 0;
  let solta;
  const ag = criarAgendador({ timers: rel.timers, pendentes: () => 0,
    sincronizar: () => new Promise((r) => { chamadas += 1; solta = () => r({ erros: [] }); }) });
  const p = ag.solicitar();
  ag.solicitar();
  ag.solicitar();
  assert.equal(chamadas, 1, "uma execução por vez");
  solta();
  await p;
  assert.equal(ag.estado(), "sincronizado");
});

test("sem conexão não tenta; com falha recua exponencialmente e volta ao normal", async () => {
  const rel = relogioFalso();
  let conectado = false;
  let falhar = true;
  let chamadas = 0;
  const ag = criarAgendador({ timers: rel.timers, online: () => conectado, pendentes: () => 2,
    sincronizar: async () => { chamadas += 1; return { erros: falhar ? [{ motivo: "cota", codigo: "cota" }] : [] }; } });
  ag.iniciar();
  await rel.avancar(0);
  assert.equal(ag.estado(), "sem_conexao");
  assert.equal(chamadas, 0);

  conectado = true;
  await rel.avancar(CINCO_MINUTOS);
  assert.equal(ag.estado(), "erro");
  assert.equal(ag.falhasSeguidas(), 1);
  await rel.avancar(CINCO_MINUTOS);          // recuo de 5 min na primeira falha
  assert.equal(ag.falhasSeguidas(), 2);
  assert.equal(ag.proximoRecuo(), CINCO_MINUTOS * 2);
  await rel.avancar(CINCO_MINUTOS * 2);
  assert.equal(ag.falhasSeguidas(), 3);
  assert.equal(ag.proximoRecuo(), CINCO_MINUTOS * 4);

  falhar = false;
  await rel.avancar(CINCO_MINUTOS * 4);
  assert.equal(ag.estado(), "pendente", "ainda há operações pendentes");
  assert.equal(ag.falhasSeguidas(), 0);
});

test("autorização expirada pausa a sincronização sem tratar como erro comum", async () => {
  const rel = relogioFalso();
  const ag = criarAgendador({ timers: rel.timers, pendentes: () => 1,
    sincronizar: async () => ({ erros: [{ motivo: "expirou", codigo: "autorizacao" }] }) });
  await ag.solicitar();
  assert.equal(ag.estado(), "pausada");
  assert.equal(ag.falhasSeguidas(), 0);
});

test("parar cancela os ciclos", async () => {
  const rel = relogioFalso();
  let chamadas = 0;
  const ag = criarAgendador({ timers: rel.timers, pendentes: () => 0,
    sincronizar: async () => { chamadas += 1; return { erros: [] }; } });
  ag.iniciar();
  await rel.avancar(0);
  ag.parar();
  await rel.avancar(CINCO_MINUTOS * 3);
  assert.equal(chamadas, 1);
});
