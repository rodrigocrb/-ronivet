"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { criarAmbienteDeTeste } = require("./ambiente");

function cenario() {
  const e = criarAmbienteDeTeste();
  e.expediente();
  return e;
}

function agendarEPreencher(e, id = "at-1", inicio = "2026-10-12T08:00", extra = {}) {
  assert.equal(e.chamar("sec@c.com", "POST", "/api/agendamentos", {
    id, inicio, id_tipo: "tipo-vacina",
    tutor: { nome: "Ana Souza", telefone: "11988887777", cpf: "529.982.247-25" },
    animal: { nome: "Thor", especie: "Cão", sexo: "MACHO" } }).status, 201);
  const valores = { produto: "V10", lote: "L-77", data_aplicacao: "2026-10-12", ...extra };
  assert.equal(e.chamar("vet@c.com", "PUT", `/api/atendimentos/${id}/valores`,
    { valores, versao: 1 }).status, 200);
}

const baixar = (e, id = "at-1") => {
  const r = e.chamar("vet@c.com", "GET", `/api/atendimentos/${id}/documento`);
  assert.equal(r.status, 200);
  return Buffer.from(r.corpo.base64, "base64").toString("utf8");
};

// ---------- 6.1 marcadores ----------

test("preenche todos os marcadores e preserva o cifrão dos valores", () => {
  const { documentos } = criarAmbienteDeTeste().R;
  const texto = documentos.preencherTexto("Nome: {a} · Valor: {b} · de novo {a}",
    { a: "Ana", b: "R$ 10 $& $1" });
  assert.equal(texto, "Nome: Ana · Valor: R$ 10 $& $1 · de novo Ana");
});

test("marcador sem valor falha em vez de sair no documento", () => {
  const { documentos } = criarAmbienteDeTeste().R;
  assert.throws(() => documentos.preencherTexto("{a} {inexistente}", { a: "1" }),
    /marcadores sem valor: inexistente/);
});

test("marcadores do texto: só minúsculas, números e _", () => {
  const { documentos } = criarAmbienteDeTeste().R;
  const achados = documentos.marcadoresDoTexto("{tutor_nome} {Maiuscula} {x1} {1x} {a b} {}");
  assert.deepEqual([...achados].sort(), ["tutor_nome", "x1"]);
});

test("vincular modelo: aceita marcadores válidos e recusa os desconhecidos", () => {
  const e = cenario();
  e.documentos.registrarModelo("modelo-ok", "Tutor {tutor_nome} - {produto} lote {lote}");
  e.documentos.registrarModelo("modelo-ruim", "Tutor {tutor_nome} {inexistente}");
  const ok = e.chamar("admin@c.com", "PUT", "/api/tipos/tipo-vacina/modelo", { modelo: "modelo-ok" });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(ok.corpo.marcadores)), ["lote", "produto", "tutor_nome"]);
  const ruim = e.chamar("admin@c.com", "PUT", "/api/tipos/tipo-vacina/modelo", { modelo: "modelo-ruim" });
  assert.equal(ruim.status, 422);
  assert.equal(ruim.corpo.detail.codigo, "marcadores_invalidos");
  assert.deepEqual(JSON.parse(JSON.stringify(ruim.corpo.detail.marcadores)), ["inexistente"]);
  const sumido = e.chamar("admin@c.com", "PUT", "/api/tipos/tipo-vacina/modelo", { modelo: "nao-existe" });
  assert.equal(sumido.status, 422);
  assert.equal(sumido.corpo.detail.codigo, "arquivo_invalido");
  assert.equal(e.chamar("sec@c.com", "PUT", "/api/tipos/tipo-vacina/modelo", { modelo: "x" }).status, 403);
  // o vínculo que falhou não altera o tipo
  const tipo = e.chamar("sec@c.com", "GET", "/api/tipos").corpo.find((t) => t.id === "tipo-vacina");
  assert.equal(tipo.arquivo_template, "modelo-ok");
});

// ---------- 6.2 PDF com CRMV, data/hora e hash ----------

test("o documento traz os dados, o CRMV e a data e hora do encerramento", () => {
  const e = cenario();
  agendarEPreencher(e);
  assert.equal(e.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/encerrar").status, 200);
  const pdf = baixar(e);
  for (const trecho of ["Tutor: Ana Souza", "Animal: Thor", "Sexo: Macho", "V10", "L-77",
    "Data da aplicação: 12/10/2026", "Próxima dose: —", "CRMV: CRMV-SP 123",
    "Atendimento nº at-1", "Encerrado em 11/10/2026 12:00"]) {
    assert.ok(pdf.includes(trecho), `faltou "${trecho}" em:\n${pdf}`);
  }
  assert.ok(!/\{[a-z_]+\}/.test(pdf), "sobrou marcador sem substituir");
});

test("o hash registrado confere com o arquivo e a verificação acusa adulteração", () => {
  const e = cenario();
  agendarEPreencher(e);
  const r = e.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/encerrar").corpo;
  assert.match(r.hash_sha256, /^[0-9a-f]{64}$/);
  assert.equal(e.amb.sha256(baixar(e)), r.hash_sha256);
  assert.equal(e.chamar("vet@c.com", "GET", "/api/atendimentos/at-1/verificacao").corpo.ok, true);
  e.repo.gravarArquivo(e.repo.ler("Atendimento")[0].arquivo_pdf, "adulterado");
  assert.equal(e.chamar("vet@c.com", "GET", "/api/atendimentos/at-1/verificacao").corpo.ok, false);
});

test("a vacina estruturada é registrada com os campos do documento", () => {
  const e = cenario();
  agendarEPreencher(e, "at-1", "2026-10-12T08:00", { proxima_dose: "2027-10-12" });
  e.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/encerrar");
  const vacinas = e.repo.ler("Vacina");
  assert.equal(vacinas.length, 1);
  assert.equal(vacinas[0].produto, "V10");
  assert.equal(vacinas[0].proxima_dose, "2027-10-12");
});

// ---------- 6.3 encerramento e documento como uma operação ----------

test("falha na geração do PDF mantém o atendimento aberto e sem documento", () => {
  const e = cenario();
  agendarEPreencher(e);
  e.documentos.falharProximo = true;
  const r = e.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/encerrar");
  assert.equal(r.status, 500);
  assert.equal(r.corpo.detail.codigo, "falha_documento");
  const at = e.repo.ler("Atendimento")[0];
  assert.equal(at.status, "AGENDADO");
  assert.equal(at.arquivo_pdf, null);
  assert.equal(e.repo.listarArquivos().length, 0);
  assert.equal(e.repo.ler("Vacina").length, 0);
  assert.equal(e.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/encerrar").status, 200);
});

test("falha ao gravar no meio do encerramento remove o arquivo já criado", () => {
  const e = cenario();
  agendarEPreencher(e);
  e.repo.falharNaMutacao = e.repo.aplicadasAteAgora() + 4;   // diário + vacina + atendimento + auditoria
  const r = e.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/encerrar");
  assert.equal(r.status, 500);
  assert.equal(e.repo.listarArquivos().length, 0, "arquivo órfão");
  assert.equal(e.repo.ler("Atendimento")[0].status, "AGENDADO");
  assert.equal(e.repo.ler("Vacina").length, 0);
});

test("reenvio do encerramento gera no máximo um documento", () => {
  const e = cenario();
  agendarEPreencher(e);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(e.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/encerrar", {}, { idOp: "op-x" }).status, 200);
    assert.equal(e.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/encerrar").status, 200);
  }
  assert.equal(e.repo.listarArquivos().length, 1);
  assert.equal(e.repo.ler("Vacina").length, 1);
});

test("campo obrigatório vazio impede o encerramento", () => {
  const e = cenario();
  e.chamar("sec@c.com", "POST", "/api/agendamentos", { id: "at-1", inicio: "2026-10-12T08:00",
    id_tipo: "tipo-vacina", tutor: { nome: "A", telefone: "1" }, animal: { nome: "B", especie: "Cão" } });
  const r = e.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/encerrar");
  assert.equal(r.status, 422);
  assert.equal(r.corpo.detail.codigo, "campos_obrigatorios");
});

// ---------- 6.4 acesso restrito ----------

test("o documento só é entregue a perfil autorizado e autenticado", () => {
  const e = cenario();
  agendarEPreencher(e);
  e.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/encerrar");
  assert.equal(e.chamar(null, "GET", "/api/atendimentos/at-1/documento").status, 401);
  assert.equal(e.chamar("sec@c.com", "GET", "/api/atendimentos/at-1/documento").status, 403);
  const vet = e.chamar("vet@c.com", "GET", "/api/atendimentos/at-1/documento");
  assert.equal(vet.status, 200);
  assert.equal(vet.corpo.tipo_conteudo, "application/pdf");
  assert.equal(e.chamar("admin@c.com", "GET", "/api/atendimentos/at-1/documento").status, 200);
  assert.equal(e.chamar("vet@c.com", "GET", "/api/atendimentos/at-1/documento")
    .corpo.nome_arquivo, "atendimento-at-1.pdf");
});

test("atendimento aberto não tem documento disponível", () => {
  const e = cenario();
  agendarEPreencher(e);
  assert.equal(e.chamar("vet@c.com", "GET", "/api/atendimentos/at-1/documento").status, 404);
});

// ---------- 6.5 modelos: troca só afeta documentos novos ----------

test("trocar o modelo não altera documentos já emitidos", () => {
  const e = cenario();
  e.documentos.registrarModelo("m1", "MODELO-UM {tutor_nome} {produto}");
  e.documentos.registrarModelo("m2", "MODELO-DOIS {tutor_nome} {lote}");
  assert.equal(e.chamar("admin@c.com", "PUT", "/api/tipos/tipo-vacina/modelo", { modelo: "m1" }).status, 200);
  agendarEPreencher(e, "at-1", "2026-10-12T08:00");
  e.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/encerrar");
  const antes = baixar(e, "at-1");

  assert.equal(e.chamar("admin@c.com", "PUT", "/api/tipos/tipo-vacina/modelo", { modelo: "m2" }).status, 200);
  agendarEPreencher(e, "at-2", "2026-10-12T08:30");
  e.chamar("vet@c.com", "POST", "/api/atendimentos/at-2/encerrar");

  assert.equal(baixar(e, "at-1"), antes, "documento antigo mudou");
  assert.ok(antes.includes("MODELO-UM Ana Souza V10"));
  assert.ok(baixar(e, "at-2").includes("MODELO-DOIS Ana Souza L-77"));
  assert.equal(e.chamar("vet@c.com", "GET", "/api/atendimentos/at-1/verificacao").corpo.ok, true);
});

// ---------- aditamentos ----------

test("aditamento só em atendimento encerrado, e somente por veterinário", () => {
  const e = cenario();
  agendarEPreencher(e);
  assert.equal(e.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/aditamentos", { texto: "x" }).status, 409);
  e.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/encerrar");
  assert.equal(e.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/aditamentos", { texto: "  " }).status, 422);
  assert.equal(e.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/aditamentos", { texto: "Retorno" }).status, 201);
  assert.equal(e.chamar("vet@c.com", "GET", "/api/atendimentos/at-1/aditamentos").corpo.length, 1);
  assert.equal(e.chamar("sec@c.com", "POST", "/api/atendimentos/at-1/aditamentos", { texto: "x" }).status, 403);
  // o aditamento não altera o documento
  assert.equal(e.chamar("vet@c.com", "GET", "/api/atendimentos/at-1/verificacao").corpo.ok, true);
});
