"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Reg = require("../web/registro");
const L = require("../web/repositorio-local");
const { criarBase, criarAparelho, agendamento } = require("./aparelho_util");

const CPF_A = "529.982.247-25";
const CPF_B = "111.444.777-35";

// ---------- 3.1 relógio e ordem ----------

test("relógio: emitir cresce sempre, mesmo com o relógio do aparelho parado ou atrasado", () => {
  const fis = { ms: 1000 };
  const r = Reg.criarRelogio({ aparelho: "a", agoraMs: () => fis.ms });
  const m1 = r.emitir();
  const m2 = r.emitir();            // mesmo instante físico
  fis.ms = 500;                     // relógio voltou
  const m3 = r.emitir();
  for (const [x, y] of [[m1, m2], [m2, m3]]) assert.equal(Reg.compararOrdem(x, y), -1);
});

test("relógio: observar uma marca adiantada empurra as próximas, sem regredir", () => {
  const r = Reg.criarRelogio({ aparelho: "a", agoraMs: () => 1000 });
  r.observar({ t: 9000, c: 4, aparelho: "b" });
  const m = r.emitir();
  assert.ok(Reg.compararOrdem({ t: 9000, c: 4, aparelho: "b" }, m) < 0);
  r.observar({ t: 10, c: 0, aparelho: "b" });   // marca antiga não regride
  assert.ok(Reg.compararOrdem(m, r.emitir()) < 0);
});

test("ordem total: desempata por aparelho e é estável", () => {
  assert.equal(Reg.compararOrdem({ t: 1, c: 0, aparelho: "a" }, { t: 1, c: 0, aparelho: "b" }), -1);
  assert.equal(Reg.compararOrdem({ t: 1, c: 1, aparelho: "a" }, { t: 1, c: 0, aparelho: "z" }), 1);
  assert.equal(Reg.compararOrdem({ t: 1, c: 0, aparelho: "a" }, { t: 1, c: 0, aparelho: "a" }), 0);
});

// ---------- 3.2 registro persistente ----------

test("registro: operação local fica no registro, na mesma gravação dos dados, e sobrevive à reabertura", async () => {
  const base = await criarBase();
  const a = await criarAparelho({ nome: "A", base });
  const r = await a.chamar("sec@c.com", "POST", "/api/agendamentos",
    agendamento("at-1", "2026-10-12T09:00", CPF_A));
  assert.equal(r.status, 201, JSON.stringify(r));
  assert.equal(a.motor.operacoes().length, 1);
  assert.equal(a.motor.pendentesDeEnvio().length, 1);
  const op = a.motor.operacoes()[0];
  assert.equal(op.email, "sec@c.com");
  assert.equal(op.aparelho, "A");

  const b = await criarAparelho({ nome: "A", base, armazenamento: a.armazenamento });
  assert.equal(JSON.stringify(b.motor.operacoes()), JSON.stringify(a.motor.operacoes()));
  assert.equal(b.estado(), a.estado());
  // o relógio persistido garante que a próxima marca é maior que a anterior
  b.relogio.ms -= 100000;
  await b.chamar("sec@c.com", "POST", "/api/agendamentos",
    agendamento("at-2", "2026-10-12T09:30", CPF_B));
  const [o1, o2] = b.motor.operacoes();
  assert.equal(Reg.compararOrdem(o1, o2), -1);
});

test("leituras e recusas sem efeito não entram no registro", async () => {
  const base = await criarBase();
  const a = await criarAparelho({ nome: "A", base });
  assert.equal((await a.chamar("sec@c.com", "GET", "/api/tutores")).status, 200);
  const ruim = await a.chamar("sec@c.com", "POST", "/api/tutores",
    { nome: "X", telefone: "1", cpf: "000.000.000-00" });
  assert.ok(ruim.status >= 400);
  assert.equal(a.motor.operacoes().length, 0);
});

// ---------- 3.3 aplicação ordenada ----------

async function trocar(de, para) {
  const ops = de.motor.operacoes().filter((o) => o.aparelho === de.nome);
  const r = para.motor.receber(ops);
  await para.repo.descarregar();
  return r;
}

test("dois aparelhos agendam o mesmo horário: todos mantêm o mesmo, o outro é recusado na ordem", async () => {
  const base = await criarBase();
  const relogio = { ms: Date.parse("2026-10-11T12:00:00-03:00") };
  const a = await criarAparelho({ nome: "A", base, relogio: { ms: relogio.ms } });
  const b = await criarAparelho({ nome: "B", base, relogio: { ms: relogio.ms + 1000 } });
  const ra = await a.chamar("sec@c.com", "POST", "/api/agendamentos",
    agendamento("at-a", "2026-10-12T09:00", CPF_A, "Ana"));
  const rb = await b.chamar("sec@c.com", "POST", "/api/agendamentos",
    agendamento("at-b", "2026-10-12T09:00", CPF_B, "Beto"));
  assert.equal(ra.status, 201);
  assert.equal(rb.status, 201, "cada aparelho aceita o seu: não se conhecem");

  await trocar(a, b);
  await trocar(b, a);
  assert.equal(a.estado(), b.estado(), "convergem");
  const recusadasA = a.motor.recusadas();
  assert.equal(recusadasA.length, 1);
  assert.equal(recusadasA[0].aparelho, "B", "B veio depois na ordem total");
  assert.equal(JSON.stringify(b.motor.recusadas()), JSON.stringify(recusadasA));
  const at = a.repo.ler("Atendimento");
  assert.equal(at.length, 1);
  assert.equal(at[0].id_atendimento, "at-a");
});

test("operação recebida por inteiro duas vezes não repete efeitos", async () => {
  const base = await criarBase();
  const a = await criarAparelho({ nome: "A", base });
  const b = await criarAparelho({ nome: "B", base });
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", CPF_A));
  const r1 = await trocar(a, b);
  const antes = b.estado();
  const r2 = await trocar(a, b);
  assert.equal(r1.novas, 1);
  assert.equal(r2.novas, 0);
  assert.equal(b.estado(), antes);
});

// ---------- 3.4 reconstrução e convergência ----------

test("operação antiga que chega tarde reconstrói o estado como na ordem correta", async () => {
  const base = await criarBase();
  const a = await criarAparelho({ nome: "A", base, relogio: { ms: 1_000_000 } });
  const b = await criarAparelho({ nome: "B", base, relogio: { ms: 2_000_000 } });
  // B fez o horário das 09:00 (mais tarde na ordem); A faz o mesmo horário e outros depois
  await b.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-b", "2026-10-12T09:00", CPF_B));
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-a", "2026-10-12T09:00", CPF_A));
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-a2", "2026-10-12T10:00", "390.533.447-05"));

  // referência: um aparelho que recebe tudo na ordem total
  const ref = await criarAparelho({ nome: "R", base });
  ref.motor.receber([...a.motor.operacoes(), ...b.motor.operacoes()]);

  // B recebe as operações de A, todas anteriores às suas: reconstrução
  const r = await trocar(a, b);
  assert.equal(r.reconstruiu, true);
  assert.equal(b.estado(), ref.estado());
  const rec = b.motor.recusadas();
  assert.equal(rec.length, 1);
  assert.equal(rec[0].id, b.motor.operacoes().find((o) => o.aparelho === "B").id);
});

function aleatorio(semente) {
  let s = semente >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

test("propriedade: qualquer ordem de chegada converge para o mesmo estado (centenas de cenários)", async () => {
  const base = await criarBase();
  const horarios = ["08:00", "08:30", "09:00", "09:30"];
  const cpfs = [CPF_A, CPF_B, "390.533.447-05"];
  for (let semente = 1; semente <= 60; semente += 1) {
    const rnd = aleatorio(semente);
    const nomes = ["A", "B", "C"];
    const ap = [];
    for (const [i, nome] of nomes.entries()) {
      ap.push(await criarAparelho({ nome, base, pontoDeControleCada: 2,
        relogio: { ms: 1_000_000 + Math.floor(rnd() * 5000) + i } }));
    }
    let n = 0;
    for (const d of ap) {
      const qtd = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < qtd; k += 1) {
        n += 1;
        d.relogio.ms += Math.floor(rnd() * 3000);
        await d.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento(
          `at-${semente}-${n}`, `2026-10-12T${horarios[Math.floor(rnd() * horarios.length)]}`,
          cpfs[Math.floor(rnd() * cpfs.length)], `Tutor ${n}`));
      }
    }
    // troca em lotes e ordens aleatórias até todos conhecerem tudo
    for (let rodada = 0; rodada < 3; rodada += 1) {
      const pares = [];
      for (const de of ap) for (const para of ap) if (de !== para) pares.push([de, para]);
      pares.sort(() => rnd() - 0.5);
      for (const [de, para] of pares) {
        const ops = de.motor.operacoes();
        const lote = ops.filter(() => rnd() < 0.7).sort(() => rnd() - 0.5);
        para.motor.receber(lote);
      }
    }
    for (const de of ap) for (const para of ap) if (de !== para) para.motor.receber(de.motor.operacoes());
    const [x, ...resto] = ap;
    for (const y of resto) {
      assert.equal(y.estado(), x.estado(), `semente ${semente}: ${x.nome} x ${y.nome}`);
      assert.equal(JSON.stringify(y.motor.operacoes()), JSON.stringify(x.motor.operacoes()),
        `semente ${semente}: registros`);
    }
    // referência: quem recebe tudo, de uma vez, em ordem
    const ref = await criarAparelho({ nome: "R", base });
    ref.motor.receber(x.motor.operacoes());
    assert.equal(ref.estado(), x.estado(), `semente ${semente}: referência`);
  }
});

test("a reconstrução e a reabertura mantêm o estado gravado de forma durável", async () => {
  const base = await criarBase();
  const a = await criarAparelho({ nome: "A", base, relogio: { ms: 1_000_000 } });
  const b = await criarAparelho({ nome: "B", base, relogio: { ms: 2_000_000 } });
  await b.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-b", "2026-10-12T09:00", CPF_B));
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-a", "2026-10-12T09:00", CPF_A));
  await trocar(a, b);
  const reaberto = await L.criarRepositorioLocal({ R: b.R, armazenamento: b.armazenamento });
  const t = reaberto.exportarTudo();
  assert.equal(JSON.stringify(Object.fromEntries(Object.keys(t).sort().map((k) => [k, t[k]]))),
    b.estado());
});
