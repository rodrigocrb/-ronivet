"use strict";
// Ambiente de teste do núcleo: API com repositório em memória, relógio controlável, documentos
// em memória e usuários/tipo iniciais usados pelos cenários de contrato.
const crypto = require("node:crypto");
const { carregar } = require("./carregar");

function criarDocumentosMemoria(R) {
  const modelos = new Map();
  const doc = {
    falharProximo: false,
    registrarModelo(id, texto) { modelos.set(id, texto); },
    listarModelos() { return [...modelos.keys()].map((id) => ({ id, nome: id })); },
    marcadoresDoModelo(id) {
      if (!modelos.has(id)) throw new Error("modelo inacessível");
      return [...R.documentos.marcadoresDoTexto(modelos.get(id))];
    },
    renderizar({ modeloId, titulo, campos, valores, identificacao }) {
      if (doc.falharProximo) {
        doc.falharProximo = false;
        throw new Error("falha simulada do conversor");
      }
      const base = modeloId
        ? modelos.get(modeloId)
        : R.documentos.textoModeloPadrao(titulo, campos);
      if (base === undefined) throw new R.documentos.FalhaDocumento(`modelo não encontrado: ${modeloId}`);
      const texto = R.documentos.preencherTexto(base, valores);
      return `%PDF-MEMORIA\n${texto}\n\n${identificacao.join("\n")}\n`;
    },
  };
  return doc;
}

function criarAmbienteDeTeste(opcoes = {}) {
  const R = carregar();
  const repo = R.criarRepositorioMemoria();
  let contador = 0;
  let relogio = opcoes.agora || "2026-10-11T12:00:00-03:00";
  const documentos = criarDocumentosMemoria(R);
  const amb = {
    segredo: "segredo-de-teste",
    agora: () => relogio,
    novoId: () => `id-${String(++contador).padStart(5, "0")}`,
    sha256: (c) => crypto.createHash("sha256").update(c).digest("hex"),
    paraBase64: (c) => Buffer.from(c).toString("base64"),
    deBase64: (t) => Buffer.from(t, "base64"),
    documentos,
  };
  const config = { permitirLoginTeste: true, googleClientId: "", urlBase: "https://exemplo.test/exec",
    ...(opcoes.config || {}) };
  const api = R.criarApi({ repo, amb, config });

  const agoraStr = "2026-01-01T00:00:00-03:00";
  const semear = [
    ["Usuario", { email: "admin@c.com", nome: "Admin", perfil: "ADMIN" }],
    ["Usuario", { email: "sec@c.com", nome: "Ana", perfil: "SECRETARIA" }],
    ["Usuario", { email: "vet@c.com", nome: "Dra. Vet", perfil: "VETERINARIO", crmv: "CRMV-SP 123" }],
    ["TipoAtendimento", { id_tipo: "tipo-vacina", nome: "Vacina", duracao_min: 30,
      criado_em: agoraStr, atualizado_em: agoraStr }],
    ["CampoDef", { id_campo: "campo-vacina-produto", id_tipo: "tipo-vacina", nome: "produto",
      rotulo: "Vacina / produto", tipo_dado: "TEXTO", obrigatorio: "SIM", ordem: 1,
      papel: "VACINA_PRODUTO" }],
    ["CampoDef", { id_campo: "campo-vacina-lote", id_tipo: "tipo-vacina", nome: "lote",
      rotulo: "Lote", tipo_dado: "TEXTO", obrigatorio: "SIM", ordem: 2, papel: "VACINA_LOTE" }],
    ["CampoDef", { id_campo: "campo-vacina-data", id_tipo: "tipo-vacina", nome: "data_aplicacao",
      rotulo: "Data da aplicação", tipo_dado: "DATA", obrigatorio: "SIM", ordem: 3,
      papel: "VACINA_DATA" }],
    ["CampoDef", { id_campo: "campo-vacina-proxima", id_tipo: "tipo-vacina", nome: "proxima_dose",
      rotulo: "Próxima dose", tipo_dado: "DATA", obrigatorio: "NAO", ordem: 4,
      papel: "VACINA_PROXIMA_DOSE" }],
  ];
  if (!opcoes.vazio) {
    repo.aplicar(semear.map(([tabela, linha]) => ({ tabela, tipo: "inserir",
      linha: R.completarLinha(tabela, linha) })));
  }

  const chamar = (email, metodo, caminho, corpo, extra = {}) => api.tratar({
    metodo, caminho, corpo, credencial: email ? `fake:${email}` : undefined, ...extra });

  return {
    R, repo, amb, api, config, documentos, chamar,
    definirAgora(iso) { relogio = iso; },
    /** Define expediente de segunda a sexta (padrão 08:00-12:00, 30 min). */
    expediente(inicio = "08:00", fim = "12:00") {
      const dias = [0, 1, 2, 3, 4, 5, 6].map((d) => (d >= 1 && d <= 5
        ? { dia_semana: d, atende: "SIM", inicio, fim, duracao_min: 30 }
        : { dia_semana: d, atende: "NAO" }));
      const r = chamar("admin@c.com", "PUT", "/api/config-horarios", { dias });
      if (r.status !== 200) throw new Error(`expediente: ${JSON.stringify(r)}`);
    },
  };
}

module.exports = { criarAmbienteDeTeste };
