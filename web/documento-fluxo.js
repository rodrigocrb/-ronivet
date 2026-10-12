"use strict";
// Documento do atendimento depois do encerramento (design 7): o PDF é gerado quando há conexão,
// gravado no Drive com nome legível e registrado no atendimento (operação "anexar"). O aparelho
// não guarda o arquivo: abrir = baixar do Drive, conferir o hash e usar um arquivo temporário.
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.RoniDocumentoFluxo = api;
})(typeof self !== "undefined" ? self : this, function () {
  const PASTA = "documentos/";

  /** Parte do nome segura para arquivo (sem separadores nem caracteres reservados). */
  const limpar = (t) => String(t == null ? "" : t).replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, 60);

  /** Nome legível do PDF: ano/AAAA-MM-DD Animal - Tutor - Tipo (id curto).pdf */
  function nomeDoDocumento(at, dados) {
    const data = String(at.inicio || at.encerrado_em || "").slice(0, 10) || "sem-data";
    const partes = [dados.valores.animal_nome, dados.valores.tutor_nome, dados.titulo]
      .map(limpar).filter(Boolean);
    const curto = limpar(at.id_atendimento).slice(0, 8);
    const via = Number(at.documento_emissao) > 1 ? ` - ${Number(at.documento_emissao)}a via` : "";
    return `${data.slice(0, 4)}/${data} ${partes.join(" - ")} (${curto})${via}.pdf`;
  }

  /**
   * deps: { R, repo, motor, drive (com gravarBytes/lerBytes), documentos (porta do núcleo),
   *         sha256(bytes), agoraIso() }
   */
  function criarFluxoDocumentos(deps) {
    const { R, repo, motor, drive, documentos, sha256 } = deps;
    const PASTA_MODELOS = "modelos/";
    const caminhoModelo = (sha) => `${PASTA_MODELOS}${sha}.docx`;
    const arquivoLocalModelo = (sha) => `modelos/${sha}.docx`;
    const pessoaDe = (at) => at.veterinario_email;

    function atendimento(id) {
      return repo.ler("Atendimento").find((a) => a.id_atendimento === id) || null;
    }
    function dados(at) {
      return R.dadosDoDocumento(R.criarTx(repo), at);
    }

    // ---------- modelos .docx ----------

    /**
     * Guarda o modelo no aparelho (e no Drive, se houver conexão) e devolve a referência
     * `docx:<sha256>:<marcadores>` para vincular ao tipo. Valida o arquivo antes.
     */
    async function guardarModelo(bytes) {
      const marcadores = await deps.docx.marcadoresDoDocx(bytes);   // recusa arquivo inválido
      const sha = sha256(bytes);
      repo.gravarArquivo(arquivoLocalModelo(sha), bytes);
      await repo.descarregar();
      let noDrive = false;
      try {
        await drive.gravarBytes(caminhoModelo(sha), bytes, { tipo: "application/vnd.openxmlformats-"
          + "officedocument.wordprocessingml.document" });
        noDrive = true;
      } catch (e) {
        if (e && e.codigo === "existe") noDrive = true;   // outro aparelho já enviou: é o mesmo hash
      }
      return { sha, marcadores, referencia: `docx:${sha}:${marcadores.join(",")}`, noDrive };
    }

    /** Bytes do modelo: do aparelho, ou do Drive (e guarda cópia local). Garante o envio ao Drive. */
    async function bytesDoModelo(sha) {
      let local = repo.existeArquivo(arquivoLocalModelo(sha)) ? repo.lerArquivo(arquivoLocalModelo(sha)) : null;
      if (local) {
        if (!(local instanceof Uint8Array)) local = Uint8Array.from(local);
        if (sha256(local) !== sha) local = null;   // cópia local corrompida: usa a do Drive
      }
      if (local) {
        try {   // o modelo precisa estar no Drive para os outros aparelhos
          await drive.gravarBytes(caminhoModelo(sha), local);
        } catch (e) {
          if (!e || e.codigo !== "existe") throw e;
        }
        return local;
      }
      const remoto = await drive.lerBytes(caminhoModelo(sha));
      if (!remoto) throw new Error("modelo do documento não encontrado no Drive");
      if (sha256(remoto) !== sha) throw new Error("modelo do documento no Drive não confere com o hash");
      repo.gravarArquivo(arquivoLocalModelo(sha), remoto);
      await repo.descarregar();
      return remoto;
    }

    /** PDF a partir do modelo .docx do tipo: preenche e converte pelo Drive. */
    async function pdfDoDocx(d, at) {
      const sha = documentos.shaDoDocx(d.modeloId);
      const modelo = await bytesDoModelo(sha);
      const preenchido = await deps.docx.preencherDocx(modelo, d.valores);   // falha se faltar valor
      return drive.converterDocxParaPdf(preenchido, `rascunho-${at.id_atendimento}`);
    }

    /** Anexa o documento ao atendimento pela operação do núcleo (registrada e replicada). */
    function anexar(at, { sha, nome, modelo }) {
      const r = motor.executarLocal({ metodo: "POST",
        caminho: `/api/atendimentos/${encodeURIComponent(at.id_atendimento)}/documento/anexar`,
        corpo: { sha256: sha, nome, modelo }, credencial: `fake:${pessoaDe(at)}`,
        hora: deps.agoraIso() });
      return r;
    }

    /**
     * Gera, grava no Drive e anexa o PDF de cada atendimento encerrado com documento pendente.
     * Devolve { gerados, erros: [{ id, motivo }] }. Falha de um não impede os demais.
     */
    const ARQ_GERADOS = "registro/docs-gerados";
    const gerados = () => (repo.existeArquivo(ARQ_GERADOS) ? JSON.parse(repo.lerArquivo(ARQ_GERADOS)) : {});

    /**
     * Apaga do Drive o arquivo que este aparelho gerou e perdeu a disputa (outro anexo venceu na
     * ordem total). A vitória só é certa depois que todos os aparelhos se manifestaram; por isso
     * o registro é mantido por um tempo e conferido a cada ciclo.
     */
    const RETENCAO_MS = 30 * 24 * 3600 * 1000;
    async function limparPerdedores() {
      const lista = gerados();
      let mudou = false;
      for (const [id, item] of Object.entries(lista)) {
        const nome = typeof item === "string" ? item : item.nome;
        const em = typeof item === "string" ? 0 : item.em;
        const at = atendimento(id);
        if (at && at.documento_estado === "GERADO" && at.documento_nome
          && at.documento_nome !== nome) {
          try { await drive.excluir(PASTA + nome); } catch (_) { continue; }
          delete lista[id];
          mudou = true;
        } else if (!at || (at.documento_nome === nome && Date.now() - em > RETENCAO_MS)) {
          delete lista[id];
          mudou = true;
        }
      }
      if (mudou) { repo.gravarArquivo(ARQ_GERADOS, JSON.stringify(lista)); await repo.descarregar(); }
    }

    async function gerarPendentes() {
      const saida = { gerados: 0, erros: [] };
      try { await limparPerdedores(); } catch (_) { /* tenta no próximo ciclo */ }
      const pendentes = repo.ler("Atendimento")
        .filter((a) => a.status === "ENCERRADO" && a.documento_estado === "PENDENTE");
      for (const at of pendentes) {
        try {
          const d = dados(at);
          const nome = nomeDoDocumento(at, d);
          const ehDocx = Boolean(d.modeloId && documentos.ehDocx && documentos.ehDocx(d.modeloId));
          let sha;
          try {
            const bytes = ehDocx ? await pdfDoDocx(d, at)
              : documentos.renderizar({ modeloId: d.modeloId, titulo: d.titulo,
                campos: d.campos, valores: d.valores, identificacao: d.identificacao });
            sha = sha256(bytes);
            await drive.gravarBytes(PASTA + nome, bytes);
          } catch (e) {
            if (!e || e.codigo !== "existe") throw e;
            // Já existe (tentativa anterior ou outro aparelho): aproveita o arquivo do Drive, sem
            // sobrescrever. A conversão do Drive não é determinística; vale quem chegou primeiro.
            const existente = await drive.lerBytes(PASTA + nome);
            if (!existente) throw e;
            sha = sha256(existente);
          }
          const lista = gerados();
          lista[at.id_atendimento] = { nome, em: Date.now() };
          repo.gravarArquivo(ARQ_GERADOS, JSON.stringify(lista));
          anexar(at, { sha, nome, modelo: ehDocx ? `docx:${documentos.shaDoDocx(d.modeloId)}`
            : (d.modeloId ? `modelo:${sha256(String(d.modeloId))}` : "padrao") });
          await repo.descarregar();
          saida.gerados += 1;
        } catch (e) {
          saida.erros.push({ id: at.id_atendimento, motivo: String((e && e.message) || e),
            codigo: e && e.codigo });
        }
      }
      return saida;
    }

    /**
     * Documentos antigos (importados) que ainda têm o arquivo no aparelho: sobem para o Drive e
     * o arquivo local é removido. Devolve { liberados, erros }.
     */
    async function liberarArquivosLocais() {
      const saida = { liberados: 0, erros: [] };
      for (const at of repo.ler("Atendimento")) {
        if (at.status !== "ENCERRADO" || !at.arquivo_pdf || !repo.existeArquivo(at.arquivo_pdf)) continue;
        try {
          const bytes = repo.lerArquivo(at.arquivo_pdf);
          const sha = sha256(bytes);
          if (at.hash_sha256 && sha !== at.hash_sha256) {
            saida.erros.push({ id: at.id_atendimento, motivo: "arquivo local não confere com o hash" });
            continue;
          }
          const caminho = PASTA + at.arquivo_pdf;
          try {
            await drive.gravarBytes(caminho, typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes);
          } catch (e) {
            if (!e || e.codigo !== "existe") throw e;
          }
          const conferido = await drive.lerBytes(caminho);
          if (!conferido || sha256(conferido) !== sha) throw new Error("o Drive não confirmou o arquivo");
          if (at.documento_estado !== "GERADO") {
            anexar(at, { sha, nome: at.arquivo_pdf, modelo: "legado" });
          }
          repo.excluirArquivo(at.arquivo_pdf);
          await repo.descarregar();
          saida.liberados += 1;
        } catch (e) {
          saida.erros.push({ id: at.id_atendimento, motivo: String((e && e.message) || e),
            codigo: e && e.codigo });
        }
      }
      return saida;
    }

    /**
     * Baixa o PDF do Drive e confere o hash. Estados: "ok" (com bytes), "pendente", "ausente"
     * (não está no Drive), "divergente" (hash não confere), "sem_documento".
     */
    async function obterBytes(idAtendimento) {
      const at = atendimento(idAtendimento);
      if (!at || at.status !== "ENCERRADO") return { estado: "sem_documento" };
      if (at.documento_estado === "PENDENTE") return { estado: "pendente" };
      const nome = at.documento_nome || at.arquivo_pdf;
      if (!nome) return { estado: "sem_documento" };
      const local = at.arquivo_pdf && repo.existeArquivo(at.arquivo_pdf)
        ? repo.lerArquivo(at.arquivo_pdf) : null;
      const bytes = local || await drive.lerBytes(PASTA + nome);
      if (!bytes) return { estado: "ausente", nome };
      const conferido = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
      if (at.hash_sha256 && sha256(conferido) !== at.hash_sha256) return { estado: "divergente", nome };
      return { estado: "ok", bytes: conferido, nome };
    }

    return { gerarPendentes, liberarArquivosLocais, obterBytes, guardarModelo, bytesDoModelo,
      nomeDoDocumento: (id) => {
      const at = atendimento(id);
      return at ? nomeDoDocumento(at, dados(at)) : null;
    } };
  }

  return { criarFluxoDocumentos, nomeDoDocumento, limpar };
});
