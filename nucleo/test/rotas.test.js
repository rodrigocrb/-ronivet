"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { criarAmbienteDeTeste } = require("./ambiente");
const { casa, substituir, extrair } = require("./contrato_util");

// ---------- 1.3 envelope e roteador ----------

test("rota desconhecida responde 404 e método errado 405", () => {
  const e = criarAmbienteDeTeste();
  assert.equal(e.chamar("sec@c.com", "GET", "/api/nao-existe").status, 404);
  assert.equal(e.chamar("sec@c.com", "DELETE", "/api/tutores").status, 405);
});

test("envelope inválido responde 422 sem executar nada", () => {
  const e = criarAmbienteDeTeste();
  for (const env of [null, {}, { metodo: "GET" }, { caminho: "/api/tutores" }, "texto"]) {
    assert.equal(e.api.tratar(env).status, 422);
  }
});

test("a resposta de erro usa o formato { detail }", () => {
  const e = criarAmbienteDeTeste();
  const r = e.chamar("sec@c.com", "GET", "/api/tutores?cpf=123");
  assert.equal(r.status, 422);
  assert.equal(r.corpo.detail, "CPF inválido");
  const v = e.chamar("sec@c.com", "POST", "/api/tutores", { nome: "", telefone: "1" });
  assert.equal(v.status, 422);
  assert.ok(Array.isArray(v.corpo.detail), "validação devolve lista");
});

test("parâmetros de caminho e de consulta são decodificados", () => {
  const e = criarAmbienteDeTeste();
  e.chamar("sec@c.com", "POST", "/api/tutores", { nome: "João da Conceição", telefone: "1" });
  const r = e.chamar("sec@c.com", "GET", "/api/tutores?q=" + encodeURIComponent("conceição"));
  assert.equal(r.corpo.length, 1);
  const mais = e.chamar("sec@c.com", "GET", "/api/tutores?q=jo%C3%A3o+da");
  assert.equal(mais.corpo.length, 1);
  assert.equal(e.chamar("admin@c.com", "PATCH", "/api/usuarios/vet%40c.com", { nome: "Vet Novo" })
    .corpo.nome, "Vet Novo");
});

test("rotas públicas funcionam sem credencial e as demais exigem", () => {
  const e = criarAmbienteDeTeste();
  assert.equal(e.chamar(null, "GET", "/api/health").status, 200);
  assert.equal(e.chamar(null, "GET", "/api/agenda?de=2026-10-12").status, 401);
});

test("erro inesperado vira 500 genérico, sem vazar detalhes", () => {
  const e = criarAmbienteDeTeste();
  const original = e.R.ROTAS.slice();
  e.R.ROTAS.push({ m: "GET", r: /^\/api\/quebra$/, perfis: null, grava: false,
    h: () => { throw new Error("segredo interno"); } });
  const silencio = console.error;
  console.error = () => {};
  try {
    const r = e.chamar("sec@c.com", "GET", "/api/quebra");
    assert.equal(r.status, 500);
    assert.equal(r.corpo.detail, "erro interno");
  } finally {
    console.error = silencio;
    e.R.ROTAS.length = 0;
    original.forEach((x) => e.R.ROTAS.push(x));
  }
});

// ---------- versão do aplicativo (spec hospedagem-google) ----------

// ---------- feed do calendário ----------

// ---------- 2.3 o próprio executor de contrato detecta divergência ----------

test("executor de contrato: comparação parcial aceita o que está contido", () => {
  assert.equal(casa({ a: 1 }, { a: 1, b: 2 }), null);
  assert.equal(casa([{ x: 1 }], [{ x: 1, y: 2 }]), null);
  assert.equal(casa({ $tamanho: 2 }, [1, 2]), null);
  assert.equal(casa({ $contem: { id: "b" } }, [{ id: "a" }, { id: "b" }]), null);
  assert.equal(casa("$presente", 0), null);
  assert.equal(casa("$nulo", null), null);
  assert.equal(casa("$qualquer", undefined), null);
});

test("executor de contrato: divergências são apontadas com o caminho do campo", () => {
  assert.match(casa({ a: 1 }, { a: 2 }), /corpo\.a: esperado 1, veio 2/);
  assert.match(casa({ a: 1 }, {}), /corpo\.a: ausente/);
  assert.match(casa([1, 2], [1]), /lista esperada/);
  assert.match(casa({ $tamanho: 3 }, [1]), /tamanho 1 != 3/);
  assert.match(casa({ $contem: { id: "z" } }, [{ id: "a" }]), /nenhum item casa/);
  assert.match(casa("$presente", null), /esperado valor/);
  assert.match(casa("$nulo", "x"), /esperado nulo/);
  assert.match(casa({ d: { e: 1 } }, { d: { e: 9 } }), /corpo\.d\.e/);
});

test("executor de contrato: variáveis guardadas e interpolação", () => {
  const v = { tutor: "t-1", n: 3 };
  assert.equal(substituir("@tutor", v), "t-1");
  assert.equal(substituir("/api/tutores/{tutor}?x={n}", v), "/api/tutores/t-1?x=3");
  assert.deepEqual(substituir({ a: ["@tutor", { b: "{n}" }] }, v), { a: ["t-1", { b: "3" }] });
  assert.equal(substituir("@naoexiste", v), "@naoexiste");
  assert.equal(extrair({ x: [{ id: 7 }] }, "x.0.id"), 7);
});
