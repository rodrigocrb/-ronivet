"use strict";
// Simulador (tarefa 5.5): N aparelhos, um Drive em memória com atraso de listagem, quedas e
// arquivos truncados, ações aleatórias e sincronizações em momentos aleatórios. Ao final,
// com a rede restabelecida, todos precisam ter exatamente o mesmo estado e as mesmas decisões.
const test = require("node:test");
const assert = require("node:assert/strict");
const { criarNuvem } = require("./drive_memoria");
const { criarSincronizador } = require("../web/sincronizacao");
const { sha256 } = require("../web/ambiente-local");
const { criarBase, criarAparelho, agendamento } = require("./aparelho_util");

function aleatorio(semente) {
  let s = semente >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const HORARIOS = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30"];
const CPFS = ["529.982.247-25", "111.444.777-35", "390.533.447-05", "453.178.287-91"];
const DIAS = ["2026-10-12", "2026-10-13"];

async function cenario(base, semente) {
  const rnd = aleatorio(semente);
  const nuvem = criarNuvem({ atrasoDeListagem: Math.floor(rnd() * 3) * 1000 });
  const n = 2 + Math.floor(rnd() * 3);                          // 2 a 4 aparelhos
  const aps = [];
  for (let i = 0; i < n; i += 1) {
    const nome = String.fromCharCode(65 + i);
    const ap = await criarAparelho({ nome, base, pontoDeControleCada: 3,
      relogio: { ms: 1_000_000 + Math.floor(rnd() * 20000) - 10000 } });   // relógios desencontrados
    ap.sync = criarSincronizador({ motor: ap.motor, repo: ap.repo, drive: nuvem.cliente(nome),
      aparelho: nome, sha256, tamanhoLote: 1 + Math.floor(rnd() * 3) });
    aps.push(ap);
  }
  let seq = 0;
  const passos = 12 + Math.floor(rnd() * 12);
  for (let p = 0; p < passos; p += 1) {
    const ap = aps[Math.floor(rnd() * aps.length)];
    nuvem.avancar(Math.floor(rnd() * 1500));
    ap.relogio.ms += Math.floor(rnd() * 4000);
    const dado = rnd();
    if (dado < 0.55) {
      seq += 1;
      await ap.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento(
        `at-${semente}-${seq}`, `${DIAS[Math.floor(rnd() * DIAS.length)]}T${HORARIOS[Math.floor(rnd() * HORARIOS.length)]}`,
        CPFS[Math.floor(rnd() * CPFS.length)], `Tutor ${seq}`));
    } else if (dado < 0.7) {
      const vivos = ap.repo.ler("Atendimento").filter((x) => x.status === "AGENDADO");
      if (vivos.length) {
        const alvo = vivos[Math.floor(rnd() * vivos.length)];
        await ap.chamar("sec@c.com", "POST", `/api/atendimentos/${alvo.id_atendimento}/cancelar`, {});
      }
    } else {
      if (rnd() < 0.2) nuvem.falhar = 1 + Math.floor(rnd() * 3);
      if (rnd() < 0.1) nuvem.truncarProximaGravacao = 25;
      await ap.sync.sincronizar();
    }
  }
  // rede restabelecida: ciclos até todos conhecerem tudo
  nuvem.falhar = 0;
  nuvem.truncarProximaGravacao = null;
  nuvem.avancar(60_000);
  for (let rodada = 0; rodada < 4; rodada += 1) {
    for (const ap of aps) await ap.sync.sincronizar();
  }
  return { aps, nuvem };
}

test("simulador: dezenas de cenários aleatórios convergem para o mesmo estado e as mesmas decisões", async () => {
  const base = await criarBase();
  let conflitos = 0;
  let reconstrucoes = 0;
  for (let semente = 1; semente <= 40; semente += 1) {
    const { aps } = await cenario(base, semente);
    const [x, ...resto] = aps;
    for (const y of resto) {
      assert.equal(y.estado(), x.estado(), `semente ${semente}: ${x.nome} x ${y.nome}`);
      assert.equal(JSON.stringify(y.motor.operacoes()), JSON.stringify(x.motor.operacoes()),
        `semente ${semente}: registros ${x.nome} x ${y.nome}`);
      assert.equal(y.motor.pendentesDeEnvio().length, 0, `semente ${semente}: pendências em ${y.nome}`);
    }
    conflitos += x.motor.recusadas().length;
    reconstrucoes += 1;
    // nenhum horário ocupado por dois atendimentos agendados no estado final
    const ocupados = x.repo.ler("Atendimento").filter((a) => a.status === "AGENDADO")
      .map((a) => a.inicio);
    assert.equal(new Set(ocupados).size, ocupados.length, `semente ${semente}: horário duplicado`);
    // um único tutor por CPF
    const cpfs = x.repo.ler("Tutor").filter((t) => t.cpf).map((t) => t.cpf);
    assert.equal(new Set(cpfs).size, cpfs.length, `semente ${semente}: CPF duplicado`);
  }
  assert.ok(conflitos > 0, "o simulador deveria produzir conflitos reais");
  assert.ok(reconstrucoes === 40);
});
