"use strict";
// Documento do atendimento (design 7): encerra sem PDF, o PDF é gerado depois, gravado só no
// Drive com nome legível, aberto sob demanda e conferido pelo hash.
const test = require("node:test");
const assert = require("node:assert/strict");
const pdf = require("../web/pdf-texto");
const A = require("../web/ambiente-local");
const { criarNuvem } = require("./drive_memoria");
const { criarSincronizador } = require("../web/sincronizacao");
const { criarBase, criarAparelho, agendamento, nucleo } = require("./aparelho_util");

const VALORES = { produto: "V10 (polivalente)", lote: "L-77", data_aplicacao: "2026-10-12" };

async function encerrar(ap, id = "at-1", tutor = "Ana Ação") {
  await ap.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento(id, "2026-10-12T09:00", "529.982.247-25", tutor));
  const v = await ap.chamar("vet@c.com", "PUT", `/api/atendimentos/${id}/valores`, { valores: VALORES, versao: 1 });
  assert.equal(v.status, 200, JSON.stringify(v));
  const e = await ap.chamar("vet@c.com", "POST", `/api/atendimentos/${id}/encerrar`, {});
  assert.equal(e.status, 200, JSON.stringify(e));
  return e.corpo;
}

const atendimento = (ap, id = "at-1") => ap.repo.ler("Atendimento").find((a) => a.id_atendimento === id);
const arquivosPdf = (ap) => ap.repo.listarArquivos().filter((c) => !c.startsWith("registro/") && !c.startsWith("local/"));

test("encerrar não gera PDF: o atendimento fica encerrado com o documento pendente", async () => {
  const base = await criarBase();
  const a = await criarAparelho({ nome: "A", base });
  const r = await encerrar(a);
  assert.equal(r.status, "ENCERRADO");
  assert.equal(r.documento, false);
  assert.equal(r.documento_estado, "PENDENTE");
  const at = atendimento(a);
  assert.equal(at.hash_sha256, null);
  assert.equal(at.arquivo_pdf, null);
  assert.ok(at.selo_integridade, "o selo dos dados já existe");
  assert.equal(arquivosPdf(a).length, 0);
  const doc = await a.chamar("vet@c.com", "GET", "/api/atendimentos/at-1/documento");
  assert.equal(doc.status, 409);
  assert.equal(doc.corpo.detail.codigo, "documento_pendente");
});

test("gerar: PDF no Drive com nome legível, atendimento anexado e nada guardado no aparelho", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await criarAparelho({ nome: "A", base });
  await encerrar(a);
  const fluxo = a.fluxoCom(nuvem.cliente("A"));
  const r = await fluxo.gerarPendentes();
  assert.equal(r.gerados, 1);
  assert.equal(r.erros.length, 0);

  const at = atendimento(a);
  assert.equal(at.documento_estado, "GERADO");
  assert.equal(at.documento_nome, "2026/2026-10-12 Pet at-1 - Ana Ação - Vacina (at-1).pdf");
  assert.match(at.hash_sha256, /^[0-9a-f]{64}$/);
  assert.ok(nuvem.arquivos.has(`documentos/${at.documento_nome}`));
  assert.equal(arquivosPdf(a).length, 0, "nenhum PDF fica no armazenamento do aparelho");

  const noDrive = nuvem.arquivos.get(`documentos/${at.documento_nome}`).conteudo;
  assert.equal(A.sha256(noDrive), at.hash_sha256);
  const texto = pdf.extrairTexto(noDrive);
  for (const t of ["Vacina", "Ana Ação", "V10 (polivalente)", "L-77", "CRMV-SP 123"]) {
    assert.ok(texto.includes(t), `faltou ${t}`);
  }
});

test("abrir sob demanda: baixa do Drive e confere o hash; ausente e divergente são identificados", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await criarAparelho({ nome: "A", base });
  await encerrar(a);
  const fluxo = a.fluxoCom(nuvem.cliente("A"));
  assert.equal((await fluxo.obterBytes("at-1")).estado, "pendente");
  await fluxo.gerarPendentes();
  const ok = await fluxo.obterBytes("at-1");
  assert.equal(ok.estado, "ok");
  assert.equal(A.sha256(ok.bytes), atendimento(a).hash_sha256);
  assert.equal(arquivosPdf(a).length, 0, "abrir não deixa cópia no aparelho");

  const caminho = `documentos/${atendimento(a).documento_nome}`;
  nuvem.arquivos.get(caminho).conteudo = Uint8Array.from([1, 2, 3]);
  assert.equal((await fluxo.obterBytes("at-1")).estado, "divergente");
  nuvem.arquivos.delete(caminho);
  assert.equal((await fluxo.obterBytes("at-1")).estado, "ausente");
  assert.equal((await fluxo.obterBytes("nao-existe")).estado, "sem_documento");
});

test("documento pelo contrato: metadados do Drive, sem base64; verificação diz que se confere ao abrir", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await criarAparelho({ nome: "A", base });
  await encerrar(a);
  await a.fluxoCom(nuvem.cliente("A")).gerarPendentes();
  const d = await a.chamar("vet@c.com", "GET", "/api/atendimentos/at-1/documento");
  assert.equal(d.status, 200);
  assert.equal(d.corpo.no_drive, true);
  assert.equal(d.corpo.base64, undefined);
  assert.equal(d.corpo.hash_sha256, atendimento(a).hash_sha256);
  const v = await a.chamar("vet@c.com", "GET", "/api/atendimentos/at-1/verificacao");
  assert.equal(v.corpo.ok, null);
  assert.equal(v.corpo.estado, "GERADO");
});

test("anexar: primeiro vence, o segundo devolve o existente; hash inválido e não encerrado são recusados", async () => {
  const base = await criarBase();
  const a = await criarAparelho({ nome: "A", base });
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", "529.982.247-25"));
  const cedo = await a.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/documento/anexar",
    { sha256: "a".repeat(64), nome: "x.pdf" });
  assert.equal(cedo.status, 409);
  await a.chamar("vet@c.com", "PUT", "/api/atendimentos/at-1/valores", { valores: VALORES, versao: 1 });
  await a.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/encerrar", {});
  const ruim = await a.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/documento/anexar",
    { sha256: "curto", nome: "x.pdf" });
  assert.equal(ruim.status, 422);
  const caminho = await a.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/documento/anexar",
    { sha256: "a".repeat(64), nome: "../fuga.pdf" });
  assert.equal(caminho.status, 422);

  const um = await a.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/documento/anexar",
    { sha256: "a".repeat(64), nome: "primeiro.pdf" });
  assert.equal(um.corpo.anexado, true);
  const selo1 = atendimento(a).selo_integridade;
  const dois = await a.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/documento/anexar",
    { sha256: "b".repeat(64), nome: "segundo.pdf" });
  assert.equal(dois.status, 200);
  assert.equal(dois.corpo.anexado, false);
  assert.equal(atendimento(a).documento_nome, "primeiro.pdf");
  assert.equal(atendimento(a).hash_sha256, "a".repeat(64));
  assert.equal(atendimento(a).selo_integridade, selo1);
});

test("dois aparelhos geram o mesmo documento: um só vale e o arquivo do perdedor é apagado do Drive", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const mk = async (nome) => {
    const ap = await criarAparelho({ nome, base });
    ap.drive = nuvem.cliente(nome);
    ap.sync = criarSincronizador({ motor: ap.motor, repo: ap.repo, drive: ap.drive, aparelho: nome,
      sha256: A.sha256 });
    ap.fluxo = ap.fluxoCom(ap.drive);
    return ap;
  };
  const a = await mk("A");
  const b = await mk("B");
  await encerrar(a);
  await a.sync.sincronizar();
  await b.sync.sincronizar();                       // B conhece o encerramento, documento pendente
  assert.equal(atendimento(b).documento_estado, "PENDENTE");

  // cada um gera por conta própria, antes de saber do outro
  await a.fluxo.gerarPendentes();
  // simula nome diferente no segundo aparelho (dados mudaram entre as gerações): renomeia o tutor
  b.repo.aplicar([{ tabela: "Tutor", tipo: "atualizar", chave: { id_tutor: b.repo.ler("Tutor")[0].id_tutor },
    mudancas: { nome: "Ana Ação Silva" } }]);
  await b.fluxo.gerarPendentes();
  assert.equal(nuvem.caminhos().filter((c) => c.startsWith("documentos/")).length, 2);

  for (let i = 0; i < 3; i += 1) {
    await a.sync.sincronizar(); await b.sync.sincronizar();
    await a.fluxo.gerarPendentes(); await b.fluxo.gerarPendentes();
  }
  assert.equal(atendimento(a).documento_nome, atendimento(b).documento_nome);
  assert.equal(atendimento(a).hash_sha256, atendimento(b).hash_sha256);
  assert.equal(nuvem.caminhos().filter((c) => c.startsWith("documentos/")).length, 1,
    "o arquivo do perdedor foi apagado");
});

test("modelo próprio do tipo (texto) é usado na geração e vale para o PDF", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await criarAparelho({ nome: "A", base });
  const m = await a.chamar("admin@c.com", "PUT", "/api/tipos/tipo-vacina/modelo", {
    modelo: "texto:ATESTADO DE VACINA\nAnimal {animal_nome} recebeu {produto}, lote {lote}.\nVet: {veterinario_nome}" });
  assert.equal(m.status, 200, JSON.stringify(m));
  await encerrar(a);
  await a.fluxoCom(nuvem.cliente("A")).gerarPendentes();
  const bytes = nuvem.arquivos.get(`documentos/${atendimento(a).documento_nome}`).conteudo;
  const t = pdf.extrairTexto(bytes);
  assert.ok(t.startsWith("ATESTADO DE VACINA\nAnimal Pet at-1 recebeu V10 (polivalente), lote L-77."), t);
});

test("falha ao gravar no Drive: o atendimento continua com documento pendente e tenta de novo", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await criarAparelho({ nome: "A", base });
  await encerrar(a);
  const fluxo = a.fluxoCom(nuvem.cliente("A"));
  nuvem.falhar = 1;
  const r1 = await fluxo.gerarPendentes();
  assert.equal(r1.gerados, 0);
  assert.equal(r1.erros.length, 1);
  assert.equal(atendimento(a).documento_estado, "PENDENTE");
  const r2 = await fluxo.gerarPendentes();
  assert.equal(r2.gerados, 1);
  assert.equal(atendimento(a).documento_estado, "GERADO");
});

test("arquivo antigo (importado) sobe para o Drive e é removido do aparelho", async () => {
  const base = await criarBase();
  const nuvem = criarNuvem();
  const a = await criarAparelho({ nome: "A", base });
  const R = a.R;
  const conteudo = Uint8Array.from(Buffer.from("%PDF-ANTIGO\nconteudo\n"));
  const sha = A.sha256(conteudo);
  a.repo.aplicar([
    { tabela: "Tutor", tipo: "inserir", linha: R.completarLinha("Tutor", { id_tutor: "t1", nome: "Maria", telefone: "1" }) },
    { tabela: "Animal", tipo: "inserir", linha: R.completarLinha("Animal", { id_animal: "a1", id_tutor: "t1", nome: "Rex", especie: "Cão" }) },
    { tabela: "Atendimento", tipo: "inserir", linha: R.completarLinha("Atendimento", { id_atendimento: "x1",
      id_animal: "a1", id_tipo: "tipo-vacina", inicio: "2026-02-01T09:00:00-03:00", duracao_min: 30,
      status: "ENCERRADO", veterinario_email: "vet@c.com", encerrado_em: "2026-02-01T09:40:00-03:00",
      arquivo_pdf: "2026/x1.pdf", hash_sha256: sha, versao: 2 }) },
  ]);
  a.repo.gravarArquivo("2026/x1.pdf", conteudo);
  await a.repo.descarregar();
  const fluxo = a.fluxoCom(nuvem.cliente("A"));
  const r = await fluxo.liberarArquivosLocais();
  assert.equal(r.liberados, 1);
  assert.equal(r.erros.length, 0);
  assert.equal(a.repo.existeArquivo("2026/x1.pdf"), false);
  assert.ok(nuvem.arquivos.has("documentos/2026/x1.pdf"));
  const at = atendimento(a, "x1");
  assert.equal(at.documento_estado, "GERADO");
  assert.equal(at.hash_sha256, sha);
  const aberto = await fluxo.obterBytes("x1");
  assert.equal(aberto.estado, "ok");
});

test("renderizar recusa marcador sem valor (FalhaDocumento), sem produzir arquivo", () => {
  const R = nucleo();
  const { criarDocumentosLocais } = require("../web/documento-local");
  const d = criarDocumentosLocais({ R, pdf });
  assert.throws(() => d.renderizar({ modeloId: "texto:Oi {faltando}", titulo: "T", campos: [],
    valores: {}, identificacao: [] }), /marcadores sem valor: faltando/);
  assert.throws(() => d.renderizar({ modeloId: "outro", titulo: "T", campos: [], valores: {},
    identificacao: [] }), /modelo não encontrado/);
});
