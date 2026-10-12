"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const D = require("../web/docx");

const enc = (t) => new TextEncoder().encode(t);
const dec = (b) => new TextDecoder().decode(b);
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

const run = (t, rpr = "") => `<w:r>${rpr}<w:t>${t}</w:t></w:r>`;
const par = (...runs) => `<w:p><w:pPr/>${runs.join("")}</w:p>`;

function modelo() {
  const corpo = [
    par(run("Tutor: "), run("{tutor"), run("_no", "<w:rPr><w:b/></w:rPr>"), run("me}"),
      run(" — telefone {tutor_telefone}")),
    par(run("Animal: {animal_nome} ({animal_especie})")),
    par(run("Sem marcador, só texto &amp; símbolos")),
    // tabela: marcador dentro de célula
    `<w:tbl><w:tr><w:tc>${par(run("Lote: {lote}"))}</w:tc><w:tc>${par(run("{produto}"))}</w:tc></w:tr></w:tbl>`,
    // caixa de texto (parágrafo aninhado dentro de outro parágrafo)
    `<w:p><w:r><w:t>Antes</w:t></w:r><w:r><w:pict><w:txbxContent>${par(run("Caixa {veterinario_nome}"))}`
      + `</w:txbxContent></w:pict></w:r></w:p>`,
    par(run("Obs:"), run("{observacoes}")),
  ].join("");
  const documento = `<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${corpo}</w:body></w:document>`;
  const cabecalho = `<?xml version="1.0"?><w:hdr ${NS}>${par(run("{clinica}"), run(" · CRMV {veterinario_crmv}"))}</w:hdr>`;
  const rodape = `<?xml version="1.0"?><w:ftr ${NS}>${par(run("Atendimento {atendimento_id}"))}</w:ftr>`;
  const imagem = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255, 254, 253]);
  return new Map([
    ["[Content_Types].xml", enc('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')],
    ["word/document.xml", enc(documento)],
    ["word/header1.xml", enc(cabecalho)],
    ["word/footer1.xml", enc(rodape)],
    ["word/media/logo.png", imagem],
    ["word/styles.xml", enc(`<w:styles ${NS}/>`)],
  ]);
}

const VALORES = { tutor_nome: "Ana & Cia <3", tutor_telefone: "11 98888-7777", animal_nome: "Rex",
  animal_especie: "Cão", lote: "L-77", produto: "V10", veterinario_nome: "Dra. Ana",
  veterinario_crmv: "CRMV-SP 123", clinica: "Clínica Pet", atendimento_id: "at-1",
  observacoes: "linha 1\nlinha 2" };

test("zip: escreve e lê de volta, preservando bytes e nomes", async () => {
  const m = modelo();
  const bytes = await D.escreverZip(m);
  const lido = await D.lerZip(bytes);
  assert.equal([...lido.keys()].join("|"), [...m.keys()].join("|"));
  for (const [nome, dados] of m) {
    assert.equal(Buffer.from(lido.get(nome)).toString("hex"), Buffer.from(dados).toString("hex"), nome);
  }
});

test("zip gerado é válido para outro leitor (Python zipfile) e tem CRC correto", async () => {
  const bytes = await D.escreverZip(modelo());
  const arq = path.join(os.tmpdir(), `roni-${process.pid}.docx`);
  fs.writeFileSync(arq, bytes);
  const r = spawnSync("python", ["-c",
    "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(len(z.namelist()))", arq],
  { encoding: "utf8" });
  fs.unlinkSync(arq);
  assert.equal(r.status, 0, r.stderr);
  const [bad, n] = r.stdout.trim().split(/\r?\n/);
  assert.equal(bad, "None");
  assert.equal(Number(n), 6);
});

test("lê zip com compressão deflate feito por outra ferramenta (Python)", async () => {
  const arq = path.join(os.tmpdir(), `roni-py-${process.pid}.docx`);
  const r = spawnSync("python", ["-c",
    "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED); "
    + "z.writestr('word/document.xml','<w:document>'+'ola {x} '*200+'</w:document>'); z.writestr('a/b.txt','hi')",
    arq], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const lido = await D.lerZip(new Uint8Array(fs.readFileSync(arq)));
  fs.unlinkSync(arq);
  assert.equal(dec(lido.get("a/b.txt")), "hi");
  assert.ok(dec(lido.get("word/document.xml")).startsWith("<w:document>ola {x} ola"));
});

test("marcadores: corpo, cabeçalho, rodapé, tabela, caixa de texto e marcador dividido em trechos", async () => {
  const bytes = await D.escreverZip(modelo());
  const achados = await D.marcadoresDoDocx(bytes);
  assert.equal(achados.join(","), [
    "animal_especie", "animal_nome", "atendimento_id", "clinica", "lote", "observacoes", "produto",
    "tutor_nome", "tutor_telefone", "veterinario_crmv", "veterinario_nome"].sort().join(","));
});

test("preencher: todos os marcadores, com escape de XML, quebra de linha e restante preservado", async () => {
  const original = modelo();
  const saida = await D.preencherDocx(await D.escreverZip(original), VALORES);
  const zip = await D.lerZip(saida);
  const doc = dec(zip.get("word/document.xml"));
  assert.ok(doc.includes("Ana &amp; Cia &lt;3"), "valor escapado");
  assert.ok(!/\{[a-z_]+\}/.test(doc), "sem marcador restante");
  assert.ok(doc.includes("Caixa Dra. Ana"));
  assert.ok(doc.includes("Lote: L-77"));
  assert.ok(doc.includes('linha 1</w:t><w:br/><w:t xml:space="preserve">linha 2'), "quebra de linha");
  assert.ok(doc.includes("Sem marcador, só texto &amp; símbolos"), "texto sem marcador intacto");
  assert.ok(/<w:rPr><w:b\/><\/w:rPr>/.test(doc), "formatação dos trechos mantida");
  const cab = dec(zip.get("word/header1.xml"));
  assert.ok(cab.includes("<w:t>Clínica Pet</w:t>") && cab.includes('<w:t xml:space="preserve"> · CRMV CRMV-SP 123</w:t>'), cab);
  assert.ok(dec(zip.get("word/footer1.xml")).includes("Atendimento at-1"));
  // o que não é texto não muda
  assert.equal(Buffer.from(zip.get("word/media/logo.png")).toString("hex"),
    Buffer.from(original.get("word/media/logo.png")).toString("hex"));
  assert.equal(dec(zip.get("word/styles.xml")), dec(original.get("word/styles.xml")));
});

test("o marcador dividido em três trechos vira um único valor no primeiro trecho", async () => {
  const saida = await D.preencherDocx(await D.escreverZip(modelo()), VALORES);
  const doc = dec((await D.lerZip(saida)).get("word/document.xml"));
  const p = doc.split("</w:p>")[0];
  assert.ok(/Tutor: <\/w:t><\/w:r><w:r><w:t>Ana &amp; Cia &lt;3<\/w:t><\/w:r>/.test(p), p);
  assert.ok(p.includes("— telefone 11 98888-7777"));
});

test("marcador sem valor: falha listando os que faltam e não produz arquivo", async () => {
  const sem = { ...VALORES };
  delete sem.lote;
  delete sem.clinica;
  const bytes = await D.escreverZip(modelo());
  await assert.rejects(() => D.preencherDocx(bytes, sem),
    (e) => /marcadores sem valor: clinica, lote/.test(e.message) && e.faltam.join(",") === "clinica,lote");
});

test("espaços nas pontas do valor recebem xml:space=preserve", async () => {
  const xml = `<w:document ${NS}>${par(run("{a}"))}</w:document>`;
  const r = D.preencherXml(xml, { a: "  com espaço  " });
  assert.ok(r.xml.includes('<w:t xml:space="preserve">  com espaço  </w:t>'));
});

test("arquivo que não é .docx é recusado com mensagem clara", async () => {
  await assert.rejects(() => D.marcadoresDoDocx(enc("isto não é um zip")), /não é um zip/);
  const sem = await D.escreverZip(new Map([["x.txt", enc("a")]]));
  await assert.rejects(() => D.marcadoresDoDocx(sem), /sem word\/document.xml/);
});

test("modelo inicial: .docx válido com os marcadores do tipo, preenchível pelo mesmo preenchedor", async () => {
  const vm = require("node:vm");
  const ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "web", "nucleo.js"), "utf8"), ctx);
  const R = ctx.RoniVet;
  const campos = [{ rotulo: "Vacina / produto", nome: "produto" }, { rotulo: "Lote", nome: "lote" }];
  const texto = R.documentos.textoModeloPadrao("Vacina", campos);
  const bytes = await D.gerarDocxInicial(texto.split(String.fromCharCode(10)));

  const arq = path.join(os.tmpdir(), `roni-ini-${process.pid}.docx`);
  fs.writeFileSync(arq, bytes);
  const r = spawnSync("python", ["-c",
    "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(len(z.namelist()))", arq],
  { encoding: "utf8" });
  fs.unlinkSync(arq);
  assert.equal(r.status, 0, r.stderr);
  const [bad, n] = r.stdout.trim().split(/\r?\n/);
  assert.equal(bad, "None");
  assert.equal(Number(n), 3);

  const achados = await D.marcadoresDoDocx(bytes);
  for (const m of ["tutor_nome", "tutor_telefone", "animal_nome", "animal_especie", "animal_sexo",
    "atendimento_tipo", "atendimento_data", "atendimento_hora", "veterinario_nome", "veterinario_crmv",
    "produto", "lote"]) assert.ok(achados.includes(m), `faltou ${m}`);

  const valores = Object.fromEntries(achados.map((m) => [m, `<${m}>`]));
  const pronto = await D.preencherDocx(bytes, valores);
  const doc = dec((await D.lerZip(pronto)).get("word/document.xml"));
  assert.ok(doc.includes("Tutor: &lt;tutor_nome&gt;"));
  assert.ok(doc.includes("Lote: &lt;lote&gt;"));
});
