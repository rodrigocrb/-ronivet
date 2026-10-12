"use strict";
// Montagem do modo local no aplicativo (design 1 e 9): banco no aparelho (IndexedDB), núcleo de
// regras, ambiente determinístico, documentos em PDF e motor de operações. A primeira abertura
// cria a clínica (administrador e tipo "Vacina") como estado-base; os demais aparelhos entram
// por instantâneo (grupo 5/6) e não semeiam nada.
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.RoniLocal = api;
})(typeof self !== "undefined" ? self : this, function () {
  const TIPO_VACINA = {
    tipo: { id_tipo: "tipo-vacina", nome: "Vacina", duracao_min: 30 },
    campos: [
      { id_campo: "campo-vacina-produto", nome: "produto", rotulo: "Vacina / produto",
        tipo_dado: "TEXTO", obrigatorio: "SIM", ordem: 1, papel: "VACINA_PRODUTO" },
      { id_campo: "campo-vacina-lote", nome: "lote", rotulo: "Lote", tipo_dado: "TEXTO",
        obrigatorio: "SIM", ordem: 2, papel: "VACINA_LOTE" },
      { id_campo: "campo-vacina-data", nome: "data_aplicacao", rotulo: "Data da aplicação",
        tipo_dado: "DATA", obrigatorio: "SIM", ordem: 3, papel: "VACINA_DATA" },
      { id_campo: "campo-vacina-proxima", nome: "proxima_dose", rotulo: "Próxima dose",
        tipo_dado: "DATA", obrigatorio: "NAO", ordem: 4, papel: "VACINA_PROXIMA_DOSE" },
    ],
  };
  const MOMENTO_BASE = "2026-01-01T00:00:00-03:00";   // mesma data de criação em toda clínica

  /**
   * deps: { R (núcleo), indexedDB, uuid(), Armazenamento (RoniRepositorioLocal),
   *         Ambiente (RoniAmbienteLocal), Registro (RoniRegistro), Pdf (RoniPdfTexto),
   *         Documento (RoniDocumentoLocal), agoraMs(), agoraIso() }
   */
  async function iniciar(deps) {
    const { R, Armazenamento, Ambiente, Registro, Pdf, Documento } = deps;
    const armazenamento = Armazenamento.armazenamentoIndexedDB(deps.indexedDB, "ronivet-local");
    const repo = await Armazenamento.criarRepositorioLocal({ R, armazenamento });

    let aparelho = repo.existeArquivo("local/aparelho") ? repo.lerArquivo("local/aparelho") : null;
    if (!aparelho) {
      aparelho = deps.uuid();
      repo.gravarArquivo("local/aparelho", aparelho);
    }

    const config = { permitirLoginTeste: true, googleClientId: "", urlBase: "" };
    const documentos = Documento.criarDocumentosLocais({ R, pdf: Pdf });
    const amb = Ambiente.criarAmbienteLocal({ documentos });
    const apiNucleo = R.criarApi({ repo, amb, config });
    const isolado = () => {
      const r = R.criarRepositorioMemoria();
      const a = Ambiente.criarAmbienteLocal({ documentos });
      return { repo: r, amb: a, api: R.criarApi({ repo: r, amb: a, config }) };
    };
    const motor = await Registro.criarMotor({ R, repo, amb, api: apiNucleo, aparelho,
      agoraMs: deps.agoraMs || (() => Date.now()), isolado });
    await repo.descarregar();

    const pessoas = () => repo.ler("Usuario").filter((u) => u.ativo === "SIM")
      .map((u) => ({ email: u.email, nome: u.nome, perfil: u.perfil }));

    /**
     * Entradas da lista de pessoas que pertencem à conta Google `email`: a própria e, nas
     * clínicas antigas, a de veterinário `vet+<email>` da mesma pessoa.
     */
    const entradasDoEmail = (email) => {
      const e = String(email || "").trim().toLowerCase();
      return pessoas().filter((p) => p.email.toLowerCase() === e || p.email.toLowerCase() === `vet+${e}`);
    };

    return {
      aparelho, repo, motor, amb, R, documentos,
      pessoas, entradasDoEmail,
      /** Aparelho sem nenhuma pessoa cadastrada: ainda não há clínica aqui. */
      semClinica: () => repo.ler("Usuario").length === 0 && motor.totalDeOperacoes() === 0
        && !motor.corte(),
      /** Opções do transporte em modo "local". */
      opcoesTransporte: {
        repo,
        novoIdOp: () => motor.novoIdOp(),
        executar: (env) => motor.executarLocal(env),
        agoraIso: deps.agoraIso,
      },
      /** Primeiro aparelho: cria o administrador e o tipo Vacina como estado-base. */
      async criarClinica({ nome, email, crmv, veterinario }) {
        if (repo.ler("Usuario").length || motor.totalDeOperacoes() || motor.corte()) {
          throw new Error("Este aparelho já tem uma clínica.");
        }
        const dono = String(email || "").trim().toLowerCase();
        const nomeLimpo = String(nome || "").trim();
        if (!nomeLimpo) throw new Error("Informe o seu nome.");
        if (!dono.includes("@")) throw new Error("Informe um e-mail válido.");
        // Quem também atende informa o CRMV: o administrador com CRMV encerra atendimentos, então
        // continua sendo uma única pessoa na lista.
        let crmvLimpo = null;
        if (veterinario) {
          crmvLimpo = String(crmv || "").trim();
          if (!crmvLimpo) throw new Error("Informe o CRMV.");
        }
        const mut = [{ tabela: "Usuario", tipo: "inserir", linha: R.completarLinha("Usuario", {
          email: dono, nome: nomeLimpo, perfil: "ADMIN", crmv: crmvLimpo }) }];
        mut.push({ tabela: "TipoAtendimento", tipo: "inserir", linha: R.completarLinha(
          "TipoAtendimento", { ...TIPO_VACINA.tipo, criado_em: MOMENTO_BASE, atualizado_em: MOMENTO_BASE }) });
        for (const c of TIPO_VACINA.campos) {
          mut.push({ tabela: "CampoDef", tipo: "inserir", linha: R.completarLinha("CampoDef",
            { ...c, id_tipo: TIPO_VACINA.tipo.id_tipo }) });
        }
        repo.aplicar(mut);
        motor.adotarComoBase();
        await repo.descarregar();
        return { email: dono, veterinario: null };
      },
    };
  }

  return { iniciar, TIPO_VACINA };
});
