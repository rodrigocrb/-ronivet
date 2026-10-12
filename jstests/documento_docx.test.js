"use strict";
// Modelo .docx da clínica: validado, guardado no Drive pelo hash, preenchido e convertido em PDF
// pelo Drive depois do encerramento (conversão simulada no Drive em memória).
const test = require("node:test");
const assert = require("node:assert/strict");
const Docx = require("../web/docx");
const A = require("../web/ambiente-local");
const { criarNuvem } = require("./drive_memoria");
const { criarSincronizador } = require("../web/sincronizacao");
const { criarBase, criarAparelho, agendamento } = require("./aparelho_util");

const enc = (t) => new TextEncoder().encode(t);
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const par = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;

async function modeloDocx(linhas, cabecalho) {
  const mapa = new Map([
    ["[Content_Types].xml", enc("<Types/>")],
    ["word/document.xml", enc(`<w:document ${NS}><w:body>${linhas.map(par).join("")}</w:body></w:document>`)],
    ["word/media/marca-dagua.png", Uint8Array.from([137, 80, 78, 71, 1, 2, 3])],
  ]);
  if (cabecalho) mapa.set("word/header1.xml", enc(`<w:hdr ${NS}>${par(cabecalho)}</w:hdr>`));
  return Docx.escreverZip(mapa);
}

const VALORES = { produto: "V10", lote: "L-77", data_aplicacao: "2026-10-12" };
const atendimento = (ap, id = "at-1") => ap.repo.ler("Atendimento").find((a) => a.id_atendimento === id);

async function encerrado(ap, id = "at-1") {
  await ap.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento(id, "2026-10-12T09:00", "529.982.247-25", "Ana Souza"));
  await ap.chamar("vet@c.com", "PUT", `/api/atendimentos/${id}/valores`, { valores: VALORES, versao: 1 });
  const e = await ap.chamar("vet@c.com", "POST", `/api/atendimentos/${id}/encerrar`, {});
  assert.equal(e.status, 200, JSON.stringify(e));
}

async function prepararModelo(ap, fluxo, linhas, cabecalho) {
  const g = await fluxo.guardarModelo(await modeloDocx(linhas, cabecalho));
  const r = await ap.chamar("admin@c.com", "PUT", "/api/tipos/tipo-vacina/modelo", { modelo: g.referencia });
  return { g, r };
}

test("guardar o modelo: valida o arquivo, calcula o hash e envia ao Drive", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await criarAparelho({ nome: "A", base });
  const fluxo = a.fluxoCom(nuvem.cliente("A"));
  const g = await fluxo.guardarModelo(await modeloDocx(["Atestado de {animal_nome}", "Lote {lote}"], "{veterinario_nome}"));
  assert.match(g.sha, /^[0-9a-f]{64}$/);
  assert.equal(g.marcadores.join(","), "animal_nome,lote,veterinario_nome");
  assert.equal(g.referencia, `docx:${g.sha}:animal_nome,lote,veterinario_nome`);
  assert.equal(g.noDrive, true);
  assert.ok(nuvem.arquivos.has(`modelos/${g.sha}.docx`));
  await assert.rejects(() => fluxo.guardarModelo(enc("não é docx")), /não é um zip/);
});

test("vincular ao tipo: marcador inexistente é recusado; válido guarda a referência replicável", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await criarAparelho({ nome: "A", base });
  const fluxo = a.fluxoCom(nuvem.cliente("A"));
  const ruim = await prepararModelo(a, fluxo, ["Oi {nao_existe}"]);
  assert.equal(ruim.r.status, 422);
  assert.equal(ruim.r.corpo.detail.codigo, "marcadores_invalidos");
  const bom = await prepararModelo(a, fluxo, ["Atestado {animal_nome} {lote}"]);
  assert.equal(bom.r.status, 200, JSON.stringify(bom.r));
  assert.equal(a.repo.ler("TipoAtendimento")[0].arquivo_template, bom.g.referencia);
});

test("encerrar e gerar: preenche o .docx, converte pelo Drive e anexa o PDF", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  // conversão simulada: PDF com o texto de todas as partes do documento (corpo e cabeçalho)
  nuvem.conversor = async (docx) => {
    const zip = await Docx.lerZip(docx);
    let txt = "";
    for (const [nome, dados] of zip) {
      if (/^word\/(document|header\d*|footer\d*)\.xml$/.test(nome)) {
        txt += new TextDecoder().decode(dados).replace(/<[^>]+>/g, " ");
      }
    }
    return Uint8Array.from(Buffer.from(`%PDF-1.4
${txt}
%%EOF`, "utf8"));
  };
  const a = await criarAparelho({ nome: "A", base });
  const fluxo = a.fluxoCom(nuvem.cliente("A"));
  const { g, r } = await prepararModelo(a, fluxo,
    ["ATESTADO DE VACINA", "Animal {animal_nome} ({animal_especie}) — {produto}, lote {lote}"], "Clínica · {veterinario_nome}");
  assert.equal(r.status, 200, JSON.stringify(r));
  await encerrado(a);
  assert.equal(atendimento(a).documento_estado, "PENDENTE");

  const res = await fluxo.gerarPendentes();
  assert.equal(res.gerados, 1, JSON.stringify(res));
  const at = atendimento(a);
  assert.equal(at.documento_estado, "GERADO");
  assert.equal(at.documento_modelo, `docx:${g.sha}`);
  const pdf = nuvem.arquivos.get(`documentos/${at.documento_nome}`).conteudo;
  assert.equal(A.sha256(pdf), at.hash_sha256);
  const texto = Buffer.from(pdf).toString("utf8");
  assert.match(texto, /^%PDF/);
  assert.ok(texto.includes("Pet at-1") && texto.includes("V10") && texto.includes("L-77"), texto);
  assert.ok(texto.includes("Clínica") && texto.includes("Dra. Vet"), "cabeçalho preenchido");
  assert.ok(!texto.includes("{lote}"));
});

test("outro aparelho gera com o modelo baixado do Drive (não tinha cópia local)", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const mk = async (nome) => {
    const ap = await criarAparelho({ nome, base });
    ap.drive = nuvem.cliente(nome);
    ap.sync = criarSincronizador({ motor: ap.motor, repo: ap.repo, drive: ap.drive, aparelho: nome, sha256: A.sha256 });
    ap.fluxo = ap.fluxoCom(ap.drive);
    return ap;
  };
  const a = await mk("A");
  const b = await mk("B");
  const { g, r } = await prepararModelo(a, a.fluxo, ["Atestado {animal_nome} {lote}"]);
  assert.equal(r.status, 200);
  await encerrado(a);
  await a.sync.sincronizar();
  await b.sync.sincronizar();                                   // B reaplica vincular e encerrar
  assert.equal(b.repo.ler("TipoAtendimento")[0].arquivo_template, g.referencia);
  assert.equal(b.repo.existeArquivo(`modelos/${g.sha}.docx`), false);
  const res = await b.fluxo.gerarPendentes();
  assert.equal(res.gerados, 1, JSON.stringify(res));
  assert.equal(b.repo.existeArquivo(`modelos/${g.sha}.docx`), true, "guardou a cópia baixada");
  assert.equal(atendimento(b).documento_estado, "GERADO");
});

test("marcador do modelo sem valor para o atendimento: fica pendente com o motivo", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await criarAparelho({ nome: "A", base });
  const fluxo = a.fluxoCom(nuvem.cliente("A"));
  // {proxima_dose} é campo do tipo, mas o atendimento não preencheu: o valor padrão é "—", então passa;
  // um marcador que o sistema não conhece só pode vir de um modelo trocado depois: simula pela referência
  const g = await fluxo.guardarModelo(await modeloDocx(["Valor {produto}", "Estranho {campo_fantasma}"]));
  a.repo.aplicar([{ tabela: "TipoAtendimento", tipo: "atualizar", chave: { id_tipo: "tipo-vacina" },
    mudancas: { arquivo_template: `docx:${g.sha}:produto` } }]);
  await encerrado(a);
  const res = await fluxo.gerarPendentes();
  assert.equal(res.gerados, 0);
  assert.match(res.erros[0].motivo, /campo_fantasma/);
  assert.equal(atendimento(a).documento_estado, "PENDENTE");
  assert.equal(nuvem.caminhos().filter((c) => c.startsWith("documentos/")).length, 0);
});

test("falha da conversão no Drive: documento segue pendente e a próxima tentativa conclui", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await criarAparelho({ nome: "A", base });
  const fluxo = a.fluxoCom(nuvem.cliente("A"));
  await prepararModelo(a, fluxo, ["Atestado {animal_nome}"]);
  await encerrado(a);
  nuvem.falharConversao = true;
  const r1 = await fluxo.gerarPendentes();
  assert.equal(r1.gerados, 0);
  assert.equal(atendimento(a).documento_estado, "PENDENTE");
  const r2 = await fluxo.gerarPendentes();
  assert.equal(r2.gerados, 1);
  assert.equal(atendimento(a).documento_estado, "GERADO");
});

test("sem modelo .docx continua valendo o modelo padrão (texto) e o de texto próprio", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await criarAparelho({ nome: "A", base });
  const fluxo = a.fluxoCom(nuvem.cliente("A"));
  await encerrado(a);
  const res = await fluxo.gerarPendentes();
  assert.equal(res.gerados, 1);
  assert.equal(atendimento(a).documento_modelo, "padrao");
});
