"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { criarNuvem } = require("./drive_memoria");
const { criarSincronizador } = require("../web/sincronizacao");
const { sha256 } = require("../web/ambiente-local");
const { criarBase, criarAparelho, agendamento } = require("./aparelho_util");

test("a auditoria registra o aparelho de origem e é igual em todos os aparelhos", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const montar = async (nome, ms) => {
    const ap = await criarAparelho({ nome, base, relogio: { ms } });
    ap.sync = criarSincronizador({ motor: ap.motor, repo: ap.repo, drive: nuvem.cliente(nome),
      aparelho: nome, sha256 });
    return ap;
  };
  const a = await montar("A", 1_000_000);
  const b = await montar("B", 1_000_100);
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-a", "2026-10-12T09:00", "529.982.247-25"));
  await b.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-b", "2026-10-12T10:00", "111.444.777-35", "B"));
  for (let i = 0; i < 2; i += 1) { await a.sync.sincronizar(); await b.sync.sincronizar(); }
  const aud = (ap, id) => ap.repo.ler("Auditoria").filter((x) => x.id_entidade === id && x.aparelho);
  assert.ok(aud(a, "at-a").length > 0);
  assert.ok(aud(a, "at-a").every((x) => x.aparelho === "A"));
  assert.ok(aud(a, "at-b").every((x) => x.aparelho === "B"), "a de B mantém o aparelho de B");
  assert.equal(a.estado(), b.estado());
});
