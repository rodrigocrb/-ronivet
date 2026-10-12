"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { criarAmbienteDeTeste } = require("./ambiente");

// ---------- credencial ----------

test("login de teste (fake:) só vale quando habilitado", () => {
  const e = criarAmbienteDeTeste({ config: { permitirLoginTeste: false } });
  const r = e.api.tratar({ metodo: "GET", caminho: "/api/auth/me", credencial: "fake:sec@c.com" });
  assert.equal(r.status, 401);
});

// ---------- 3.2 perfis aplicados no backend ----------

test("perfil informado no corpo da requisição é ignorado", () => {
  const e = criarAmbienteDeTeste();
  const r = e.chamar("sec@c.com", "POST", "/api/usuarios",
    { email: "novo@c.com", nome: "Novo", perfil: "ADMIN" });
  assert.equal(r.status, 403);
  const r2 = e.api.tratar({ metodo: "GET", caminho: "/api/auth/me", credencial: "fake:sec@c.com",
    corpo: { perfil: "ADMIN" } });
  assert.equal(r2.corpo.perfil, "SECRETARIA");
});

test("veterinário não altera horários de atendimento", () => {
  const e = criarAmbienteDeTeste();
  assert.equal(e.chamar("vet@c.com", "PUT", "/api/config-horarios", { dias: [] }).status, 403);
});

test("usuário desativado perde o acesso na próxima operação", () => {
  const e = criarAmbienteDeTeste();
  assert.equal(e.chamar("sec@c.com", "GET", "/api/tutores").status, 200);
  const r = e.chamar("admin@c.com", "PATCH", "/api/usuarios/sec%40c.com", { ativo: "NAO" });
  assert.equal(r.status, 200);
  assert.equal(e.chamar("sec@c.com", "GET", "/api/tutores").status, 401);
  assert.equal(e.chamar(null, "POST", "/api/auth/login", { credential: "fake:sec@c.com" }).status, 403);
});

// ---------- 3.3 gestão de usuários ----------

test("somente administrador gerencia usuários", () => {
  const e = criarAmbienteDeTeste();
  for (const quem of ["sec@c.com", "vet@c.com"]) {
    assert.equal(e.chamar(quem, "GET", "/api/usuarios").status, 403);
    assert.equal(e.chamar(quem, "POST", "/api/usuarios",
      { email: "x@c.com", nome: "X", perfil: "SECRETARIA" }).status, 403);
    assert.equal(e.chamar(quem, "PATCH", "/api/usuarios/admin%40c.com", { ativo: "NAO" }).status, 403);
  }
});

test("cadastra, altera o perfil e desativa usuários", () => {
  const e = criarAmbienteDeTeste();
  const criado = e.chamar("admin@c.com", "POST", "/api/usuarios",
    { email: "Nova@C.com", nome: "Nova", perfil: "VETERINARIO", crmv: "CRMV-SP 9" });
  assert.equal(criado.status, 201);
  assert.equal(criado.corpo.email, "nova@c.com");
  assert.equal(e.chamar("nova@c.com", "GET", "/api/auth/me").corpo.perfil, "VETERINARIO");
  assert.equal(e.chamar("admin@c.com", "POST", "/api/usuarios",
    { email: "nova@c.com", nome: "Outra", perfil: "SECRETARIA" }).status, 409);
  assert.equal(e.chamar("admin@c.com", "POST", "/api/usuarios",
    { email: "vet2@c.com", nome: "Sem CRMV", perfil: "VETERINARIO" }).status, 422);
  const novoPerfil = e.chamar("admin@c.com", "PATCH", "/api/usuarios/nova%40c.com",
    { perfil: "SECRETARIA" });
  assert.equal(novoPerfil.corpo.perfil, "SECRETARIA");
  assert.equal(e.chamar("admin@c.com", "PATCH", "/api/usuarios/nova%40c.com", { ativo: "NAO" })
    .corpo.ativo, "NAO");
  assert.equal(e.chamar("admin@c.com", "PATCH", "/api/usuarios/nao%40existe.com", { nome: "x" }).status, 404);
});

test("não é possível desativar o último administrador", () => {
  const e = criarAmbienteDeTeste();
  const r = e.chamar("admin@c.com", "PATCH", "/api/usuarios/admin%40c.com", { ativo: "NAO" });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.detail.codigo, "ultimo_administrador");
  const r2 = e.chamar("admin@c.com", "PATCH", "/api/usuarios/admin%40c.com", { perfil: "SECRETARIA" });
  assert.equal(r2.status, 409);
});

// ---------- 3.4 trilha de auditoria ----------

test("a trilha registra usuário, ação e entidade, e não guarda o CPF completo", () => {
  const e = criarAmbienteDeTeste();
  e.chamar("sec@c.com", "POST", "/api/tutores", { id: "t1", nome: "Ana", telefone: "1", cpf: "529.982.247-25" });
  e.chamar("sec@c.com", "GET", "/api/tutores?cpf=52998224725");
  e.chamar("sec@c.com", "PATCH", "/api/tutores/t1", { cpf: "111.444.777-35" });
  const trilha = e.chamar("admin@c.com", "GET", "/api/auditoria?limite=50").corpo;
  const texto = JSON.stringify(trilha);
  assert.ok(!texto.includes("52998224725") && !texto.includes("11144477735"),
    "CPF completo apareceu na trilha");
  const criar = trilha.find((a) => a.acao === "CRIAR" && a.entidade === "Tutor");
  assert.equal(criar.usuario_email, "sec@c.com");
  assert.equal(criar.id_entidade, "t1");
  const consulta = trilha.find((a) => a.acao === "CONSULTAR" && a.campo === "cpf");
  assert.equal(consulta.valor_novo, "***.982.247-**");
  const alteracao = trilha.find((a) => a.acao === "ALTERAR" && a.campo === "cpf");
  assert.equal(alteracao.valor_anterior, "***.982.247-**");
  assert.equal(alteracao.valor_novo, "***.444.777-**");
});

test("filtros da trilha: por entidade e por usuário", () => {
  const e = criarAmbienteDeTeste();
  e.chamar("sec@c.com", "POST", "/api/tutores", { id: "t1", nome: "Ana", telefone: "1" });
  e.chamar("admin@c.com", "POST", "/api/tipos", { nome: "Consulta" });
  const porEntidade = e.chamar("admin@c.com", "GET", "/api/auditoria?entidade=TipoAtendimento").corpo;
  assert.ok(porEntidade.length >= 1 && porEntidade.every((a) => a.entidade === "TipoAtendimento"));
  const porUsuario = e.chamar("admin@c.com", "GET", "/api/auditoria?usuario=sec%40c.com").corpo;
  assert.ok(porUsuario.length >= 1 && porUsuario.every((a) => a.usuario_email === "sec@c.com"));
});
