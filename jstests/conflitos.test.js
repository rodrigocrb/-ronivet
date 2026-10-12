"use strict";
// Conflitos entre aparelhos (spec conflitos-sincronizacao): decisão idêntica em todos.
const test = require("node:test");
const assert = require("node:assert/strict");
const { criarBase, criarAparelho, agendamento } = require("./aparelho_util");

async function trocar(a, b) {
  b.motor.receber(a.motor.operacoes().filter((o) => o.aparelho === a.nome));
  a.motor.receber(b.motor.operacoes().filter((o) => o.aparelho === b.nome));
  await a.repo.descarregar();
  await b.repo.descarregar();
}

async function par() {
  const base = await criarBase();
  const a = await criarAparelho({ nome: "A", base, relogio: { ms: 1_000_000 } });
  const b = await criarAparelho({ nome: "B", base, relogio: { ms: 2_000_000 } });
  return { a, b };
}

test("horário liberado por cancelamento antes do segundo: o segundo permanece válido", async () => {
  const { a, b } = await par();
  // A agenda e cancela; B agenda o mesmo horário depois (na ordem total)
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-a", "2026-10-12T09:00", "529.982.247-25"));
  const c = await a.chamar("sec@c.com", "POST", "/api/atendimentos/at-a/cancelar", {});
  assert.ok(c.status < 300, JSON.stringify(c));
  await b.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-b", "2026-10-12T09:00", "111.444.777-35"));
  await trocar(a, b);
  assert.equal(a.estado(), b.estado());
  assert.equal(a.motor.recusadas().length, 0);
  const vivos = a.repo.ler("Atendimento").filter((x) => x.status === "AGENDADO");
  assert.equal(JSON.stringify(vivos.map((x) => x.id_atendimento)), '["at-b"]');
});

test("mesmo CPF em dois aparelhos: um único tutor, com os animais de ambos", async () => {
  const { a, b } = await par();
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-a", "2026-10-12T09:00", "529.982.247-25", "Ana"));
  await b.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-b", "2026-10-12T10:00", "529.982.247-25", "Ana S."));
  await trocar(a, b);
  assert.equal(a.estado(), b.estado());
  const tutores = a.repo.ler("Tutor");
  assert.equal(tutores.length, 1, "um único tutor");
  const animais = a.repo.ler("Animal");
  assert.equal(animais.length, 2);
  assert.ok(animais.every((x) => x.id_tutor === tutores[0].id_tutor));
  assert.equal(a.repo.ler("Atendimento").length, 2, "os dois atendimentos foram mantidos");
  assert.equal(a.motor.recusadas().length, 0);
});

test("edição concorrente com o encerramento: o encerrado prevalece e a edição fica registrada", async () => {
  const { a, b } = await par();
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", "529.982.247-25"));
  await trocar(a, b);                               // ambos conhecem o atendimento
  const valores = { produto: "V10", lote: "L1", data_aplicacao: "2026-10-12" };
  // A (relógio menor) preenche e encerra
  const v = await a.chamar("vet@c.com", "PUT", "/api/atendimentos/at-1/valores", { valores, versao: 1 });
  assert.equal(v.status, 200, JSON.stringify(v));
  const e = await a.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/encerrar", {});
  assert.equal(e.status, 200, JSON.stringify(e));
  // B, sem saber, edita o mesmo atendimento depois (na ordem total)
  const ed = await b.chamar("vet@c.com", "PUT", "/api/atendimentos/at-1/valores",
    { valores: { produto: "OUTRA" }, versao: 1 });
  assert.equal(ed.status, 200, "B aceita localmente");
  await trocar(a, b);
  assert.equal(a.estado(), b.estado());
  const at = a.repo.ler("Atendimento").find((x) => x.id_atendimento === "at-1");
  assert.equal(at.status, "ENCERRADO");
  const campo = a.repo.ler("CampoValor").find((x) => x.valor === "OUTRA");
  assert.equal(campo, undefined, "o valor recusado não entrou");
  const rec = a.motor.recusadas();
  assert.equal(rec.length, 1);
  assert.equal(rec[0].aparelho, "B");
  assert.equal(JSON.stringify(b.motor.recusadas()), JSON.stringify(rec));
});

test("mesmos conflitos listados em aparelhos diferentes", async () => {
  const { a, b } = await par();
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-a", "2026-10-12T09:00", "529.982.247-25"));
  await b.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-b", "2026-10-12T09:00", "111.444.777-35"));
  await trocar(a, b);
  assert.equal(JSON.stringify(a.motor.recusadas()), JSON.stringify(b.motor.recusadas()));
  assert.equal(a.motor.recusadas().length, 1);
});

test("conflitos pendentes: quem, onde e por quê; marcar como resolvido mantém o registro", async () => {
  const { a, b } = await par();
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-a", "2026-10-12T09:00", "529.982.247-25"));
  await b.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-b", "2026-10-12T09:00", "111.444.777-35"));
  await trocar(a, b);
  const [c] = b.motor.conflitos();
  assert.equal(c.aparelho, "B");
  assert.equal(c.pessoa, "sec@c.com");
  assert.equal(c.motivo.status, 409);
  assert.equal(c.caminho, "/api/agendamentos");
  assert.equal(b.motor.resolverConflito(c.id, "2026-10-12T10:00:00Z"), true);
  assert.equal(b.motor.conflitos().length, 0);
  assert.equal(b.motor.conflitos({ incluirResolvidos: true })[0].resolvidoEm, "2026-10-12T10:00:00Z");
  assert.equal(b.motor.recusadas().length, 1, "a operação recusada continua registrada");
  await b.repo.descarregar();
  const reaberto = await criarAparelho({ nome: "B", base: null, armazenamento: b.armazenamento });
  assert.equal(reaberto.motor.conflitos().length, 0, "a conferência sobrevive à reabertura");
  assert.equal(b.motor.resolverConflito("nao-existe"), false);
});
