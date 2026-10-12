"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { criarClienteDrive } = require("../web/drive-rest");
const { abrirRaiz } = require("../web/raiz");
const { criarDriveFalso } = require("./drive_falso");

function cliente(falso, extras = {}) {
  let renovacoes = 0;
  const c = criarClienteDrive({ fetchImpl: falso.fetchImpl, abrirRaiz,
    obterToken: async (renovar) => { if (renovar) renovacoes += 1; return falso.estado.tokenValido; },
    ...extras });
  c.renovacoes = () => renovacoes;
  return c;
}

test("grava, lê, lista e exclui por caminho lógico, criando as pastas sob a raiz RoniVet", async () => {
  const f = criarDriveFalso();
  const d = cliente(f);
  assert.equal(await d.ler("operacoes/A/lote-000001.json"), null);
  assert.deepEqual(await d.listar("operacoes/"), []);
  await d.gravar("operacoes/A/lote-000001.json", "{\"x\":1}");
  await d.gravar("operacoes/B/lote-000001.json", "outro");
  await d.gravar("aparelhos/A.json", "{}");
  assert.equal(await d.ler("operacoes/A/lote-000001.json"), "{\"x\":1}");
  assert.equal(JSON.stringify((await d.listar("operacoes/")).map((x) => x.caminho)),
    JSON.stringify(["operacoes/A/lote-000001.json", "operacoes/B/lote-000001.json"]));
  assert.equal(JSON.stringify((await d.listar("aparelhos/")).map((x) => x.caminho)),
    JSON.stringify(["aparelhos/A.json"]));
  assert.equal(f.pastas().filter((p) => p.name === "RoniVet").length, 1);

  await d.excluir("aparelhos/A.json");
  assert.equal(await d.ler("aparelhos/A.json"), null);
});

test("gravar recusa nome existente, salvo substituir; conteúdo com acentos e quebras de linha", async () => {
  const f = criarDriveFalso();
  const d = cliente(f);
  const texto = "Ação\r\nlinha 2 — «ok» 日本\n--fim--";
  await d.gravar("documentos/h.pdf.b64", texto);
  assert.equal(await d.ler("documentos/h.pdf.b64"), texto);
  await assert.rejects(() => d.gravar("documentos/h.pdf.b64", "novo"), (e) => e.codigo === "existe");
  await d.gravar("documentos/h.pdf.b64", "novo", { substituir: true });
  assert.equal(await d.ler("documentos/h.pdf.b64"), "novo");
  assert.equal(f.nomes().filter((n) => n === "h.pdf.b64").length, 1);
});

test("nomes com aspas simples são tratados na consulta", async () => {
  const f = criarDriveFalso();
  const d = cliente(f);
  await d.gravar("documentos/l'ivro.txt", "a");
  assert.equal(await d.ler("documentos/l'ivro.txt"), "a");
});

test("token vencido: renova uma vez e repete; sem autorização vira erro \"autorizacao\"", async () => {
  const f = criarDriveFalso();
  let atual = "velho";
  const d = criarClienteDrive({ fetchImpl: f.fetchImpl, abrirRaiz,
    obterToken: async (renovar) => { if (renovar) atual = f.estado.tokenValido; return atual; } });
  assert.equal(await d.ler("a/b.txt"), null, "funciona depois de renovar");
  const ruim = criarClienteDrive({ fetchImpl: f.fetchImpl, abrirRaiz, obterToken: async () => "errado" });
  await assert.rejects(() => ruim.ler("a/b.txt"), (e) => e.codigo === "autorizacao");
  const sem = criarClienteDrive({ fetchImpl: f.fetchImpl, abrirRaiz,
    obterToken: async () => { throw new Error("sem conta"); } });
  await assert.rejects(() => sem.ler("a/b.txt"), (e) => e.codigo === "autorizacao");
});

test("classifica falhas: cota, indisponível e rede", async () => {
  const f = criarDriveFalso();
  const d = cliente(f);
  await d.gravar("a/x.txt", "1");
  f.estado.falhas.push({ status: 403, reason: "userRateLimitExceeded" });
  await assert.rejects(() => d.ler("a/x.txt"), (e) => e.codigo === "cota");
  f.estado.falhas.push({ status: 429 });
  await assert.rejects(() => d.ler("a/x.txt"), (e) => e.codigo === "cota");
  f.estado.falhas.push({ status: 503 });
  await assert.rejects(() => d.ler("a/x.txt"), (e) => e.codigo === "indisponivel");
  f.estado.falhas.push("rede");
  await assert.rejects(() => d.ler("a/x.txt"), (e) => e.codigo === "indisponivel");
  assert.equal(await d.ler("a/x.txt"), "1");
});

test("criação simultânea do mesmo arquivo: fica o mais antigo e o outro aparelho recebe \"existe\"", async () => {
  const f = criarDriveFalso();
  const a = cliente(f);
  const b = cliente(f);
  // B cria entre a verificação e o envio de A: simula com a chamada de B no meio do upload de A
  const original = f.fetchImpl;
  let injetado = false;
  const interceptado = { ...f, fetchImpl: async (url, init) => {
    if (!injetado && /upload\/drive\/v3\/files\?uploadType=multipart/.test(url) && init.method === "POST") {
      injetado = true;
      await original(url, init);   // a gravação "de B" chega primeiro, com o mesmo nome
    }
    return original(url, init);
  } };
  const a2 = criarClienteDrive({ fetchImpl: interceptado.fetchImpl, abrirRaiz,
    obterToken: async () => f.estado.tokenValido });
  await assert.rejects(() => a2.gravar("operacoes/A/lote-000001.json", "A"), (e) => e.codigo === "existe");
  assert.equal(f.nomes().filter((n) => n === "lote-000001.json").length, 1);
  void a; void b;
});

test("pastas duplicadas (criadas em paralelo) são lidas em conjunto", async () => {
  const f = criarDriveFalso();
  const d = cliente(f);
  await d.gravar("operacoes/A/lote-000001.json", "1");
  // outro aparelho criou uma segunda "operacoes" com outro arquivo, em paralelo
  const raiz = f.pastas().find((p) => p.name === "RoniVet");
  const dupla = [...f.arquivos.values()].length;
  void dupla;
  const op2 = { id: "dup-ops", name: "operacoes", mimeType: "application/vnd.google-apps.folder",
    parents: [raiz.id], createdTime: "2026-10-12T11:00:00.000Z", modifiedTime: "x", content: "", trashed: false };
  f.arquivos.set(op2.id, op2);
  const b = { id: "dup-b", name: "B", mimeType: "application/vnd.google-apps.folder",
    parents: ["dup-ops"], createdTime: "2026-10-12T11:00:01.000Z", modifiedTime: "x", content: "", trashed: false };
  f.arquivos.set(b.id, b);
  f.arquivos.set("dup-f", { id: "dup-f", name: "lote-000001.json", mimeType: "text/plain",
    parents: ["dup-b"], createdTime: "2026-10-12T11:00:02.000Z", modifiedTime: "x", content: "do B", trashed: false });
  const fresco = cliente(f);
  const lista = (await fresco.listar("operacoes/")).map((x) => x.caminho);
  assert.equal(JSON.stringify(lista),
    JSON.stringify(["operacoes/A/lote-000001.json", "operacoes/B/lote-000001.json"]));
  assert.equal(await fresco.ler("operacoes/B/lote-000001.json"), "do B");
});

test("binários (PDF): grava e lê byte a byte, com nome acentuado; existe e substituir", async () => {
  const f = criarDriveFalso();
  const d = cliente(f);
  const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x0d, 0x0a, 0x0d, 0x0a, 0xff, 0x00, 0xe2, 0x80, 0x2d, 0x2d]);
  await d.gravarBytes("documentos/2026/2026-10-12 Rex - João - Vacina (abc).pdf", bytes);
  const lido = await d.lerBytes("documentos/2026/2026-10-12 Rex - João - Vacina (abc).pdf");
  assert.equal(Buffer.from(lido).toString("hex"), Buffer.from(bytes).toString("hex"));
  assert.ok(f.nomes().includes("2026-10-12 Rex - João - Vacina (abc).pdf"));
  await assert.rejects(() => d.gravarBytes("documentos/2026/2026-10-12 Rex - João - Vacina (abc).pdf", bytes),
    (e) => e.codigo === "existe");
  await d.gravarBytes("documentos/2026/2026-10-12 Rex - João - Vacina (abc).pdf", Uint8Array.from([1]),
    { substituir: true });
  assert.equal((await d.lerBytes("documentos/2026/2026-10-12 Rex - João - Vacina (abc).pdf")).length, 1);
  assert.equal(await d.lerBytes("documentos/nao-existe.pdf"), null);
});

test("conversão .docx -> PDF pelo Drive: envia convertendo, exporta e apaga o temporário", async () => {
  const f = criarDriveFalso();
  const d = cliente(f);
  const docx = Uint8Array.from(Buffer.from("PK conteudo do docx lote L-77"));
  const pdf = await d.converterDocxParaPdf(docx, "rascunho-x");
  const texto = Buffer.from(pdf).toString("latin1");
  assert.match(texto, /^%PDF-1\.4/);
  assert.ok(texto.includes("conteudo do docx lote L-77"));
  assert.equal(f.nomes().includes("rascunho-x"), false, "temporário apagado");
  assert.ok(f.estado.chamadas.some((c) => /export/.test(c)));
});

test("compartilhamento: convida, não repete, lista e retira o acesso da pessoa", async () => {
  const f = criarDriveFalso();
  const c = criarClienteDrive({ fetchImpl: f.fetchImpl, abrirRaiz, obterToken: async () => "tok-1" });
  await c.gravar("config/x.json", "{}");   // cria a pasta da clínica
  const r1 = await c.compartilhar("Ana@Clinica.com");
  assert.equal(r1.jaTinha, false);
  assert.equal((await c.compartilhar("ana@clinica.com")).jaTinha, true);
  assert.deepEqual((await c.listarCompartilhamentos()).map((p) => [p.email, p.papel]),
    [["dono@clinica.com", "owner"], ["ana@clinica.com", "writer"]]);
  assert.equal((await c.deixarDeCompartilhar("ana@clinica.com")).removido, true);
  assert.equal((await c.deixarDeCompartilhar("ana@clinica.com")).removido, false);
  await assert.rejects(() => c.deixarDeCompartilhar("dono@clinica.com"), /proprietário/);
});

test("a pasta da clínica é a marcada: outra pasta com o mesmo nome é ignorada e quem entra não cria", async () => {
  const f = criarDriveFalso();
  // pasta comum da pessoa com o mesmo nome (sem a marca da clínica)
  const comum = criarClienteDrive({ fetchImpl: f.fetchImpl, abrirRaiz: async () => ({ id: "x" }),
    obterToken: async () => "tok-1" });
  void comum;
  await f.fetchImpl("https://www.googleapis.com/drive/v3/files", { method: "POST",
    headers: { Authorization: "Bearer tok-1" },
    body: JSON.stringify({ name: "RoniVet", mimeType: "application/vnd.google-apps.folder" }) });
  const entrante = criarClienteDrive({ fetchImpl: f.fetchImpl, abrirRaiz,
    obterToken: async () => "tok-1", podeCriarRaiz: () => false });
  assert.equal(await entrante.localizarRaiz(), null);
  await assert.rejects(() => entrante.gravar("x.json", "{}"), (e) => e.codigo === "sem_pasta");
  assert.equal(f.pastas().length, 1, "não criou outra pasta");

  const origem = criarClienteDrive({ fetchImpl: f.fetchImpl, abrirRaiz, obterToken: async () => "tok-1" });
  await origem.gravar("x.json", "{}");
  assert.equal(f.pastas().length, 2);
  assert.ok(await entrante.localizarRaiz(), "agora a pasta marcada existe");
});
