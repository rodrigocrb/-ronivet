"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
require("fake-indexeddb/auto");
const { IDBFactory } = require("fake-indexeddb");
const L = require("../web/repositorio-local");
const igual = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));

function nucleo() {
  const ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "web", "nucleo.js"), "utf8"), ctx);
  return ctx.RoniVet;
}

const ISO = "2026-01-01T00:00:00-03:00";
const SEMENTE = [
  ["Usuario", { email: "admin@c.com", nome: "Admin", perfil: "ADMIN" }],
  ["TipoAtendimento", { id_tipo: "tipo-vacina", nome: "Vacina", duracao_min: 30,
    criado_em: ISO, atualizado_em: ISO }],
];

function criarApiLocal(R, repo) {
  let n = 0;
  const amb = { agora: () => "2026-10-11T12:00:00-03:00", novoId: () => `id-${++n}`,
    sha256: (c) => crypto.createHash("sha256").update(c).digest("hex"),
    paraBase64: (c) => Buffer.from(c).toString("base64"),
    deBase64: (t) => Buffer.from(t, "base64"), documentos: {} };
  return R.criarApi({ repo, amb, config: { permitirLoginTeste: true, googleClientId: "" } });
}

async function semear(R, repo) {
  repo.aplicar(SEMENTE.map(([tabela, linha]) => ({ tabela, tipo: "inserir",
    linha: R.completarLinha(tabela, linha) })));
  await repo.descarregar();
}

test("grava e reabre mantendo linhas, ordem e arquivos (IndexedDB)", async () => {
  const R = nucleo();
  const idb = new IDBFactory();
  const a1 = L.armazenamentoIndexedDB(idb, "t1");
  let repo = await L.criarRepositorioLocal({ R, armazenamento: a1 });
  await semear(R, repo);
  repo.aplicar([{ tabela: "Usuario", tipo: "inserir",
    linha: R.completarLinha("Usuario", { email: "b@c.com", nome: "B", perfil: "SECRETARIA" }) }]);
  repo.aplicar([{ tabela: "Usuario", tipo: "atualizar", chave: { email: "admin@c.com" },
    mudancas: { nome: "Administrador" } }]);
  repo.gravarArquivo("docs/x.txt", "conteudo");
  await repo.descarregar();
  assert.equal(repo.pendenteDeGravacao(), false);

  repo = await L.criarRepositorioLocal({ R, armazenamento: L.armazenamentoIndexedDB(idb, "t1") });
  igual(repo.ler("Usuario").map((u) => [u.email, u.nome]),
    [["admin@c.com", "Administrador"], ["b@c.com", "B"]]);
  assert.equal(repo.lerArquivo("docs/x.txt"), "conteudo");

  repo.aplicar([{ tabela: "Usuario", tipo: "excluir", chave: { email: "b@c.com" } }]);
  repo.excluirArquivo("docs/x.txt");
  await repo.descarregar();
  repo = await L.criarRepositorioLocal({ R, armazenamento: L.armazenamentoIndexedDB(idb, "t1") });
  igual(repo.ler("Usuario").map((u) => u.email), ["admin@c.com"]);
  assert.equal(repo.existeArquivo("docs/x.txt"), false);
});

test("interrupção antes de descarregar não deixa a operação pela metade", async () => {
  const R = nucleo();
  const armazenamento = L.armazenamentoMemoria();
  const repo = await L.criarRepositorioLocal({ R, armazenamento });
  await semear(R, repo);
  const api = criarApiLocal(R, repo);
  const login = { credencial: "fake:admin@c.com" };
  const exp = api.tratar({ metodo: "PUT", caminho: "/api/config-horarios", ...login,
    corpo: { dias: [1, 2, 3, 4, 5].map((d) => ({ dia_semana: d, atende: "SIM",
      inicio: "08:00", fim: "12:00", duracao_min: 30 })) } });
  assert.equal(exp.status, 200, JSON.stringify(exp));
  await repo.descarregar();

  const r = api.tratar({ metodo: "POST", caminho: "/api/agendamentos", ...login,
    corpo: { id: "at-1", inicio: "2026-10-12T09:00", id_tipo: "tipo-vacina",
      tutor: { nome: "Ana", telefone: "11988887777", cpf: "529.982.247-25" },
      animal: { nome: "Thor", especie: "Cão" } } });
  assert.equal(r.status, 201, JSON.stringify(r));
  assert.equal(repo.pendenteDeGravacao(), true);

  // "o aplicativo morre" aqui: reabre sem ter descarregado
  const reaberto = await L.criarRepositorioLocal({ R, armazenamento });
  assert.equal(reaberto.ler("Tutor").length, 0);
  assert.equal(reaberto.ler("Animal").length, 0);
  assert.equal(reaberto.ler("Atendimento").length, 0);

  await repo.descarregar();
  const depois = await L.criarRepositorioLocal({ R, armazenamento });
  assert.equal(depois.ler("Tutor").length, 1);
  assert.equal(depois.ler("Animal").length, 1);
  assert.equal(depois.ler("Atendimento").length, 1);
  assert.equal(depois.ler("Operacao").filter((o) => o.estado === "CONCLUIDA").length >= 1, true);
});

test("falha na gravação mantém o pendente e a próxima tentativa grava tudo", async () => {
  const R = nucleo();
  const armazenamento = L.armazenamentoMemoria();
  const repo = await L.criarRepositorioLocal({ R, armazenamento });
  await semear(R, repo);
  repo.aplicar([{ tabela: "Usuario", tipo: "inserir",
    linha: R.completarLinha("Usuario", { email: "z@c.com", nome: "Z", perfil: "SECRETARIA" }) }]);
  armazenamento.falharProximaGravacao = true;
  await assert.rejects(() => repo.descarregar(), /simulada/);
  assert.equal(repo.pendenteDeGravacao(), true);
  assert.equal((await L.criarRepositorioLocal({ R, armazenamento })).ler("Usuario").length, 1);
  await repo.descarregar();
  assert.equal((await L.criarRepositorioLocal({ R, armazenamento })).ler("Usuario").length, 2);
});
