"use strict";
// Montagem do modo local como o aplicativo faz (web/local.js), sobre fake-indexeddb.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { IDBFactory } = require("fake-indexeddb");
const Local = require("../web/local");
const Armazenamento = require("../web/repositorio-local");
const Ambiente = require("../web/ambiente-local");
const Registro = require("../web/registro");
const Pdf = require("../web/pdf-texto");
const Documento = require("../web/documento-local");
const { criarTransporte, agoraIso } = require("../web/transporte");

function nucleo() {
  const ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "web", "nucleo.js"), "utf8"), ctx);
  return ctx.RoniVet;
}

let n = 0;
const montar = (indexedDB) => Local.iniciar({ R: nucleo(), indexedDB, uuid: () => `ap-${++n}`,
  Armazenamento, Ambiente, Registro, Pdf, Documento, agoraMs: () => Date.parse("2026-10-12T12:00:00Z"),
  agoraIso });

function transporteDe(local) {
  return criarTransporte({ config: { modo: "local", versaoApp: "1.0.0" },
    obterCredencial: async () => null, local: local.opcoesTransporte });
}

test("primeira abertura: sem clínica; criar a clínica semeia admin e tipo Vacina e sobrevive à reabertura", async () => {
  const idb = new IDBFactory();
  const l = await montar(idb);
  assert.equal(l.semClinica(), true);
  await assert.rejects(() => l.criarClinica({ nome: "", email: "a@b.com" }), /nome/);
  await assert.rejects(() => l.criarClinica({ nome: "Dra. Ana", email: "sem-arroba" }), /e-mail/);
  await l.criarClinica({ nome: "Dra. Ana", email: "Ana@Clinica.com" });
  assert.equal(l.semClinica(), false);
  assert.equal(JSON.stringify(l.pessoas()),
    JSON.stringify([{ email: "ana@clinica.com", nome: "Dra. Ana", perfil: "ADMIN" }]));
  await assert.rejects(() => l.criarClinica({ nome: "Outra", email: "o@o.com" }), /já tem/);

  const l2 = await montar(idb);               // reabrir o aplicativo
  assert.equal(l2.semClinica(), false);
  assert.equal(l2.aparelho, l.aparelho, "o aparelho mantém o mesmo identificador");
  assert.equal(l2.repo.ler("TipoAtendimento").length, 1);
});

test("fluxo completo pelo transporte local: login, agendamento, encerrar e documento", async () => {
  const l = await montar(new IDBFactory());
  await assert.rejects(() => l.criarClinica({ nome: "Dra. Ana", email: "ana@clinica.com", veterinario: true }), /CRMV/);
  await l.criarClinica({ nome: "Dra. Ana", email: "ana@clinica.com", crmv: "CRMV-SP 999", veterinario: true });
  const t = transporteDe(l);
  const chamar = async (metodo, caminho, corpo, como = "ana@clinica.com") => {
    const r = await t.rede(caminho, { method: metodo, credencial: `fake:${como}`,
      body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    return { status: r.status, corpo: await r.json() };
  };
  assert.equal((await chamar("POST", "/api/auth/login", { credential: "fake:ana@clinica.com" })).status, 200);
  const cfg = await chamar("PUT", "/api/config-horarios", { dias: [1, 2, 3, 4, 5].map((d) => ({
    dia_semana: d, atende: "SIM", inicio: "08:00", fim: "12:00", duracao_min: 30 })) });
  assert.equal(cfg.status, 200, JSON.stringify(cfg));
  const ag = await chamar("POST", "/api/agendamentos", { id: "at-1", inicio: "2026-10-12T09:00",
    id_tipo: "tipo-vacina", tutor: { nome: "João", telefone: "11999990000" },
    animal: { nome: "Rex", especie: "Cão" } });
  assert.equal(ag.status, 201, JSON.stringify(ag));
  const v = await chamar("PUT", "/api/atendimentos/at-1/valores", { versao: 1,
    valores: { produto: "V10", lote: "L1", data_aplicacao: "2026-10-12" } }, "ana@clinica.com");
  assert.equal(v.status, 200, JSON.stringify(v));
  assert.equal((await chamar("POST", "/api/atendimentos/at-1/encerrar", {}, "ana@clinica.com")).status, 200);
  const doc = await chamar("GET", "/api/atendimentos/at-1/documento", undefined, "ana@clinica.com");
  assert.equal(doc.status, 409, "o PDF ainda será gerado pelo Drive");
  assert.equal(doc.corpo.detail.codigo, "documento_pendente");
  assert.equal(l.repo.ler("Atendimento")[0].documento_estado, "PENDENTE");
  assert.equal(l.motor.operacoes().length >= 3, true);
});

test("a gravação é durável: reabrir o aplicativo mantém os dados e o registro", async () => {
  const idb = new IDBFactory();
  const l = await montar(idb);
  await l.criarClinica({ nome: "Dra. Ana", email: "ana@clinica.com", crmv: "CRMV-SP 999" });
  const t = transporteDe(l);
  const r = await t.rede("/api/tutores", { method: "POST", credencial: "fake:ana@clinica.com",
    body: JSON.stringify({ nome: "Maria", telefone: "11988887777", cpf: "529.982.247-25" }) });
  assert.equal(r.status, 201);
  const l2 = await montar(idb);
  assert.equal(l2.repo.ler("Tutor").length, 1);
  assert.equal(l2.motor.operacoes().length, 1);
});

test("entradasDoEmail: a conta Google leva às entradas da pessoa, inclusive a antiga `vet+`", async () => {
  const ap = await montar(new IDBFactory());
  await ap.criarClinica({ nome: "Dra. Ana", email: "Ana@Clinica.com", crmv: "CRMV-SP 1", veterinario: true });
  const achadas = ap.entradasDoEmail("ana@clinica.com").map((p) => [p.email, p.perfil]);
  assert.equal(JSON.stringify(achadas), JSON.stringify([["ana@clinica.com", "ADMIN"]]));
  assert.equal(ap.entradasDoEmail("outra@clinica.com").length, 0);
  // clínicas antigas: a entrada de veterinário `vet+<email>` pertence à mesma conta Google
  ap.repo.aplicar([{ tabela: "Usuario", tipo: "inserir", linha: ap.R.completarLinha("Usuario",
    { email: "vet+ana@clinica.com", nome: "Dra. Ana", perfil: "VETERINARIO", crmv: "CRMV-SP 1" }) }]);
  assert.equal(ap.entradasDoEmail("Ana@clinica.com").length, 2);
});
