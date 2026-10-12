"use strict";
// Apoio dos testes do motor: aparelhos simulados com o mesmo estado-base.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { criarTransporte } = require("../web/transporte");
const L = require("../web/repositorio-local");
const A = require("../web/ambiente-local");
const Reg = require("../web/registro");
const pdf = require("../web/pdf-texto");
const { criarDocumentosLocais } = require("../web/documento-local");
const { criarFluxoDocumentos } = require("../web/documento-fluxo");

function nucleo() {
  const ctx = vm.createContext({ console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "web", "nucleo.js"), "utf8"), ctx);
  return ctx.RoniVet;
}

const INICIO = "2026-01-01T00:00:00-03:00";
const SEMENTE = [
  ["Usuario", { email: "admin@c.com", nome: "Admin", perfil: "ADMIN" }],
  ["Usuario", { email: "sec@c.com", nome: "Ana", perfil: "SECRETARIA" }],
  ["Usuario", { email: "vet@c.com", nome: "Dra. Vet", perfil: "VETERINARIO", crmv: "CRMV-SP 123" }],
  ["TipoAtendimento", { id_tipo: "tipo-vacina", nome: "Vacina", duracao_min: 30,
    criado_em: INICIO, atualizado_em: INICIO }],
  ["CampoDef", { id_campo: "campo-vacina-produto", id_tipo: "tipo-vacina", nome: "produto",
    rotulo: "Vacina / produto", tipo_dado: "TEXTO", obrigatorio: "SIM", ordem: 1, papel: "VACINA_PRODUTO" }],
  ["CampoDef", { id_campo: "campo-vacina-lote", id_tipo: "tipo-vacina", nome: "lote",
    rotulo: "Lote", tipo_dado: "TEXTO", obrigatorio: "SIM", ordem: 2, papel: "VACINA_LOTE" }],
  ["CampoDef", { id_campo: "campo-vacina-data", id_tipo: "tipo-vacina", nome: "data_aplicacao",
    rotulo: "Data da aplicação", tipo_dado: "DATA", obrigatorio: "SIM", ordem: 3, papel: "VACINA_DATA" }],
  ["CampoDef", { id_campo: "campo-vacina-proxima", id_tipo: "tipo-vacina", nome: "proxima_dose",
    rotulo: "Próxima dose", tipo_dado: "DATA", obrigatorio: "NAO", ordem: 4, papel: "VACINA_PROXIMA_DOSE" }],
];

/** Documentos reais do aparelho (PDF de texto determinístico). */
function documentosSimples(R) {
  return criarDocumentosLocais({ R, pdf });
}

const configNucleo = { permitirLoginTeste: true, googleClientId: "" };

/** Estado-base comum: usuários, um tipo e expediente de segunda a sexta (08:00-12:00). */
async function criarBase(opcoes = {}) {
  const R = nucleo();
  const repo = await L.criarRepositorioLocal({ R, armazenamento: L.armazenamentoMemoria() });
  repo.aplicar(SEMENTE.map(([tabela, linha]) => ({ tabela, tipo: "inserir",
    linha: R.completarLinha(tabela, linha) })));
  const amb = A.criarAmbienteLocal();
  const api = R.criarApi({ repo, amb, config: configNucleo });
  if (!opcoes.semHorarios) {
    const r = amb.executarComo({ idOp: "base-config", hora: INICIO }, () => api.tratar({
      metodo: "PUT", caminho: "/api/config-horarios", credencial: "fake:admin@c.com",
      idOp: "base-config", corpo: { dias: [0, 1, 2, 3, 4, 5, 6].map((d) => (d >= 1 && d <= 5
        ? { dia_semana: d, atende: "SIM", inicio: "08:00", fim: "12:00", duracao_min: 30 }
        : { dia_semana: d, atende: "NAO" })) } }));
    if (r.status !== 200) throw new Error(`base: ${JSON.stringify(r)}`);
  }
  return JSON.stringify(repo.exportarTudo());
}

/**
 * Aparelho simulado. `relogio` é um objeto { ms } ajustável (relógio do aparelho).
 * Reabrir: passe o mesmo `armazenamento`.
 */
async function criarAparelho({ nome, base, armazenamento, relogio, pontoDeControleCada }) {
  const R = nucleo();
  const arm = armazenamento || L.armazenamentoMemoria();
  const repo = await L.criarRepositorioLocal({ R, armazenamento: arm });
  if (base && repo.ler("Usuario").length === 0) {
    repo.substituirTudo(JSON.parse(base));
    await repo.descarregar();
  }
  const docs = documentosSimples(R);
  const amb = A.criarAmbienteLocal({ documentos: docs });
  const api = R.criarApi({ repo, amb, config: configNucleo });
  const rel = relogio || { ms: Date.parse("2026-10-11T12:00:00-03:00") };
  const isolado = () => {
    const r = R.criarRepositorioMemoria();
    const a = A.criarAmbienteLocal({ documentos: documentosSimples(R) });
    return { repo: r, amb: a, api: R.criarApi({ repo: r, amb: a, config: configNucleo }) };
  };
  const motor = await Reg.criarMotor({ R, repo, amb, api, aparelho: nome,
    agoraMs: () => rel.ms, pontoDeControleCada, isolado });
  const t = criarTransporte({ config: { modo: "local" },
    local: { repo, novoIdOp: () => motor.novoIdOp(), executar: (env) => motor.executarLocal(env),
      agoraIso: () => "2026-10-11T12:00:00-03:00" } });

  /** Chama a rede como a tela faria; devolve { status, corpo }. */
  async function chamar(como, metodo, caminho, corpo, extra = {}) {
    const r = await t.rede(caminho, { method: metodo, credencial: `fake:${como}`,
      body: corpo === undefined ? undefined : JSON.stringify(corpo), ...extra });
    return { status: r.status, corpo: await r.json() };
  }
  // Tabelas em ordem alfabética (a ordem das linhas dentro de cada tabela conta).
  /** Fluxo de documentos deste aparelho sobre um cliente de Drive (memória ou REST). */
  const fluxoCom = (drive) => criarFluxoDocumentos({ R, repo, motor, drive, documentos: docs,
    sha256: A.sha256, docx: require("../web/docx"),
    agoraIso: () => "2026-10-11T12:30:00-03:00" });
  const estado = () => {
    const t = repo.exportarTudo();
    return JSON.stringify(Object.fromEntries(Object.keys(t).sort().map((k) => [k, t[k]])));
  };
  return { nome, R, repo, armazenamento: arm, motor, t, chamar, estado, relogio: rel, fluxoCom };
}

function agendamento(id, inicio, cpf, nome = "Tutor") {
  return { id, inicio, id_tipo: "tipo-vacina",
    tutor: { nome, telefone: "11988887777", cpf },
    animal: { nome: `Pet ${id}`, especie: "Cão" } };
}

module.exports = { nucleo, criarBase, criarAparelho, agendamento, SEMENTE };
