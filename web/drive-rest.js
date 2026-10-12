"use strict";
// Cliente REST do Google Drive (API v3) para a sincronização (design 5 e 6). Implementa a mesma
// interface do Drive em memória (listar / ler / gravar / excluir, com caminhos lógicos como
// "operacoes/A/lote-000001.json") e a API de pastas usada por raiz.js. O escopo `drive.file`
// só enxerga o que o próprio aplicativo criou, na conta autenticada.
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.RoniDriveRest = api;
})(typeof self !== "undefined" ? self : this, function () {
  const BASE = "https://www.googleapis.com/drive/v3";
  const ENVIO = "https://www.googleapis.com/upload/drive/v3";
  const PASTA = "application/vnd.google-apps.folder";
  // Propriedade pública gravada na pasta da clínica: é o que a distingue de qualquer outra pasta
  // com o mesmo nome no Drive da pessoa.
  const MARCA = { chave: "ronivet", valor: "clinica" };

  /** Erro com `codigo`: "autorizacao" | "cota" | "indisponivel" | "existe" | "sem_pasta" | "erro". */
  class DriveErro extends Error {
    constructor(codigo, mensagem, status) {
      super(mensagem);
      this.codigo = codigo;
      this.status = status || null;
    }
  }

  const aspas = (t) => String(t).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const antigoPrimeiro = (a, b) => (a.createdTime !== b.createdTime
    ? (a.createdTime < b.createdTime ? -1 : 1) : (a.id < b.id ? -1 : 1));

  /**
   * opcoes: { fetchImpl, obterToken(renovar?: boolean) -> Promise<string>, nomeRaiz,
   *           abrirRaiz({api, nome, criar}) (de raiz.js), podeCriarRaiz() -> boolean }
   */
  function criarClienteDrive(opcoes) {
    const buscar = opcoes.fetchImpl;
    const nomeRaiz = opcoes.nomeRaiz || "RoniVet";
    let raizId = null;
    const cachePastas = new Map();   // "idPai/nome" -> id da pasta (a mais antiga)

    // ---------- HTTP ----------

    async function chamar(url, init = {}, tentativa = 0) {
      let token;
      try {
        token = await opcoes.obterToken(tentativa > 0);
      } catch (e) {
        throw new DriveErro("autorizacao", "Sem autorização do Google para o Drive.", 401);
      }
      let r;
      try {
        r = await buscar(url, { ...init, headers: { ...(init.headers || {}),
          Authorization: `Bearer ${token}` } });
      } catch (e) {
        throw new DriveErro("indisponivel", "Sem conexão com o Google Drive.");
      }
      if (r.ok) return r;
      if (r.status === 401 && tentativa === 0) return chamar(url, init, 1);   // token vencido
      let motivo = "";
      try {
        const j = await r.json();
        motivo = (j.error && (j.error.errors && j.error.errors[0] && j.error.errors[0].reason
          || j.error.status)) || "";
      } catch (_) { /* sem corpo */ }
      if (r.status === 401) throw new DriveErro("autorizacao", "Autorização do Google expirou.", 401);
      if (r.status === 429 || /rateLimit|quotaExceeded|dailyLimit/i.test(motivo)) {
        throw new DriveErro("cota", "Limite de uso do Google Drive atingido.", r.status);
      }
      if (r.status === 403) throw new DriveErro("autorizacao", "Acesso negado pelo Google Drive.", 403);
      if (r.status >= 500) throw new DriveErro("indisponivel", "Google Drive indisponível.", r.status);
      throw new DriveErro("erro", `Falha do Google Drive (${r.status}).`, r.status);
    }

    const json = async (url, init) => (await chamar(url, init)).json();

    // ---------- arquivos e pastas (baixo nível) ----------

    async function listarFilhos(idPai, extra = "") {
      const saida = [];
      let pagina = "";
      do {
        const q = `'${aspas(idPai)}' in parents and trashed = false${extra}`;
        const url = `${BASE}/files?q=${encodeURIComponent(q)}`
          + `&fields=${encodeURIComponent("nextPageToken,files(id,name,mimeType,createdTime,modifiedTime)")}`
          + `&pageSize=1000${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ""}`;
        const r = await json(url);
        saida.push(...(r.files || []));
        pagina = r.nextPageToken || "";
      } while (pagina);
      return saida;
    }

    async function criarPastaEm(nome, paiId, propriedades) {
      const meta = { name: nome, mimeType: PASTA };
      if (propriedades) meta.properties = propriedades;
      if (paiId) meta.parents = [paiId];
      return json(`${BASE}/files?fields=${encodeURIComponent("id,name,createdTime")}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta) });
    }

    /** API de pastas usada por raiz.js. */
    const apiPastas = {
      async listarPastas(nome) {
        // Só a pasta marcada como da clínica (propriedade pública): com acesso amplo ao Drive, uma
        // pasta qualquer chamada "RoniVet" da pessoa não pode ser confundida com ela.
        const q = `name = '${aspas(nome)}' and mimeType = '${PASTA}' and trashed = false `
          + `and properties has { key='${MARCA.chave}' and value='${MARCA.valor}' }`;
        const r = await json(`${BASE}/files?q=${encodeURIComponent(q)}`
          + `&fields=${encodeURIComponent("files(id,createdTime)")}&pageSize=100`);
        return (r.files || []).map((f) => ({ id: f.id, criadaEm: f.createdTime }));
      },
      async criarPasta(nome) {
        const p = await criarPastaEm(nome, null, { [MARCA.chave]: MARCA.valor });
        return { id: p.id, criadaEm: p.createdTime };
      },
      async listarFilhos(idPasta) {
        return (await listarFilhos(idPasta)).map((f) => ({ id: f.id, nome: f.name,
          ehPasta: f.mimeType === PASTA }));
      },
      async mover(idItem, deId, paraId) {
        await json(`${BASE}/files/${encodeURIComponent(idItem)}?addParents=${encodeURIComponent(paraId)}`
          + `&removeParents=${encodeURIComponent(deId)}&fields=id`, { method: "PATCH",
          headers: { "Content-Type": "application/json" }, body: "{}" });
      },
      async excluirPasta(idPasta) {
        await chamar(`${BASE}/files/${encodeURIComponent(idPasta)}`, { method: "DELETE" });
      },
    };

    async function obterRaiz() {
      if (raizId) return raizId;
      // Quem entrou pela clínica de outra pessoa nunca cria a pasta: se ela não aparece, é que
      // ainda não foi compartilhada com esta conta (criar outra dividiria a clínica em duas).
      const podeCriar = opcoes.podeCriarRaiz ? opcoes.podeCriarRaiz() : true;
      const r = await opcoes.abrirRaiz({ api: apiPastas, nome: nomeRaiz, criar: podeCriar,
        reconciliar: false });
      if (!r) {
        throw new DriveErro("sem_pasta",
          "A pasta da clínica ainda não foi compartilhada com esta conta Google.", 404);
      }
      raizId = r.id;
      return raizId;
    }

    /** Procura a pasta da clínica (a criada pelo primeiro aparelho e compartilhada) sem criar. */
    async function localizarRaiz() {
      if (raizId) return raizId;
      const r = await opcoes.abrirRaiz({ api: apiPastas, nome: nomeRaiz, criar: false,
        reconciliar: false });
      if (!r) return null;
      raizId = r.id;
      return raizId;
    }

    // ---------- compartilhamento da pasta da clínica com as pessoas ----------

    const papelDe = (p) => (p.role === "owner" ? "owner" : p.role);

    /** Contas com acesso à pasta: [{ id, email, papel }] (sem a pasta, nada a listar). */
    async function listarCompartilhamentos() {
      const raiz = await localizarRaiz();
      if (!raiz) return [];
      const r = await json(`${BASE}/files/${encodeURIComponent(raiz)}/permissions`
        + `?fields=${encodeURIComponent("permissions(id,emailAddress,role,type)")}&pageSize=100`);
      return (r.permissions || []).filter((p) => p.type === "user" && p.emailAddress)
        .map((p) => ({ id: p.id, email: p.emailAddress.toLowerCase(), papel: papelDe(p) }));
    }

    /** Compartilha a pasta (edição) com a conta; o Google avisa a pessoa por e-mail. */
    async function compartilhar(email) {
      const alvo = String(email || "").trim().toLowerCase();
      if (!alvo.includes("@")) throw new DriveErro("erro", "E-mail inválido para compartilhar.");
      const raiz = await obterRaiz();
      const ja = (await listarCompartilhamentos()).find((p) => p.email === alvo);
      if (ja) return { email: alvo, jaTinha: true, papel: ja.papel };
      await json(`${BASE}/files/${encodeURIComponent(raiz)}/permissions`
        + `?sendNotificationEmail=true&fields=id`, { method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "user", role: "writer", emailAddress: alvo }) });
      return { email: alvo, jaTinha: false, papel: "writer" };
    }

    /** Retira o acesso da conta à pasta (o proprietário não pode ser retirado). */
    async function deixarDeCompartilhar(email) {
      const alvo = String(email || "").trim().toLowerCase();
      const raiz = await localizarRaiz();
      if (!raiz) return { email: alvo, removido: false };
      const p = (await listarCompartilhamentos()).find((x) => x.email === alvo);
      if (!p) return { email: alvo, removido: false };
      if (p.papel === "owner") throw new DriveErro("erro", "O proprietário da pasta não pode ser retirado.");
      await chamar(`${BASE}/files/${encodeURIComponent(raiz)}/permissions/${encodeURIComponent(p.id)}`,
        { method: "DELETE" });
      return { email: alvo, removido: true };
    }

    /** Pastas com este nome sob `paiId` (pode haver duplicatas criadas em paralelo). */
    async function pastasNomeadas(paiId, nome) {
      const filhos = await listarFilhos(paiId, ` and name = '${aspas(nome)}' and mimeType = '${PASTA}'`);
      return filhos.sort(antigoPrimeiro);
    }

    async function pastaDoCaminho(partes, criar) {
      let atual = await obterRaiz();
      for (const nome of partes) {
        const chave = `${atual}/${nome}`;
        if (cachePastas.has(chave)) { atual = cachePastas.get(chave); continue; }
        let achadas = await pastasNomeadas(atual, nome);
        if (!achadas.length) {
          if (!criar) return null;
          const nova = await criarPastaEm(nome, atual);
          // criação paralela por outro aparelho: vale a mais antiga
          achadas = await pastasNomeadas(atual, nome);
          if (!achadas.some((p) => p.id === nova.id)) achadas.push(nova);
          achadas.sort(antigoPrimeiro);
        }
        cachePastas.set(chave, achadas[0].id);
        atual = achadas[0].id;
      }
      return atual;
    }

    /** Todas as pastas do caminho (inclui duplicatas criadas em paralelo), sem criar. */
    async function todasAsPastas(partes) {
      let bases = [await obterRaiz()];
      for (const nome of partes) {
        const proximas = [];
        for (const b of bases) for (const p of await pastasNomeadas(b, nome)) proximas.push(p.id);
        bases = proximas;
      }
      return bases;
    }

    const separar = (caminho) => {
      const partes = String(caminho).split("/").filter(Boolean);
      return { pasta: partes.slice(0, -1), nome: partes[partes.length - 1] };
    };

    async function arquivosNomeados(pastaId, nome) {
      const f = await listarFilhos(pastaId, ` and name = '${aspas(nome)}' and mimeType != '${PASTA}'`);
      return f.sort(antigoPrimeiro);
    }

    // ---------- interface lógica ----------

    function multipart(meta, conteudo, tipo) {
      const limite = `roni${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      const corpo = `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
        + `${JSON.stringify(meta)}\r\n--${limite}\r\nContent-Type: ${tipo}\r\n\r\n${conteudo}\r\n--${limite}--`;
      return { corpo, tipo: `multipart/related; boundary=${limite}` };
    }

    return {
      DriveErro,
      apiPastas,

      async listar(prefixo = "") {
        const partes = String(prefixo).split("/");
        partes.pop();                                // último trecho é nome parcial
        const dirs = partes.filter(Boolean);
        // pode haver pastas de mesmo nome (criação paralela): percorre todas
        const bases = await todasAsPastas(dirs);
        const topo = dirs.length ? `${dirs.join("/")}/` : "";
        const saida = [];
        const visitar = async (idPasta, relativo) => {
          for (const f of await listarFilhos(idPasta)) {
            if (f.mimeType === PASTA) await visitar(f.id, `${relativo}${f.name}/`);
            else saida.push({ caminho: `${topo}${relativo}${f.name}`, modificadoEm: f.modifiedTime });
          }
        };
        for (const id of bases) await visitar(id, "");
        const vistos = new Set();
        return saida.filter((x) => x.caminho.startsWith(prefixo) && !vistos.has(x.caminho)
          && vistos.add(x.caminho)).sort((x, y) => (x.caminho < y.caminho ? -1 : 1));
      },

      async ler(caminho) {
        const { pasta, nome } = separar(caminho);
        let a = null;
        for (const pastaId of await todasAsPastas(pasta)) {
          [a] = await arquivosNomeados(pastaId, nome);
          if (a) break;
        }
        if (!a) return null;
        const r = await chamar(`${BASE}/files/${encodeURIComponent(a.id)}?alt=media`);
        return r.text();
      },

      /** Cria; recusa (DriveErro "existe") se já existe, salvo `substituir`. */
      async gravar(caminho, conteudo, opcoesGravar = {}) {
        const { pasta, nome } = separar(caminho);
        const pastaId = await pastaDoCaminho(pasta, true);
        const existentes = await arquivosNomeados(pastaId, nome);
        const tipo = "text/plain; charset=UTF-8";
        if (existentes.length) {
          if (!opcoesGravar.substituir) throw new DriveErro("existe", `já existe: ${caminho}`);
          await chamar(`${ENVIO}/files/${encodeURIComponent(existentes[0].id)}?uploadType=media&fields=id`,
            { method: "PATCH", headers: { "Content-Type": tipo }, body: String(conteudo) });
          return { criado: false };
        }
        const m = multipart({ name: nome, parents: [pastaId] }, String(conteudo), tipo);
        const novo = await json(`${ENVIO}/files?uploadType=multipart&fields=${encodeURIComponent("id,createdTime")}`,
          { method: "POST", headers: { "Content-Type": m.tipo }, body: m.corpo });
        // Criação simultânea do mesmo nome por dois aparelhos: fica o mais antigo.
        const todos = await arquivosNomeados(pastaId, nome);
        if (todos.length > 1 && todos[0].id !== novo.id) {
          await chamar(`${BASE}/files/${encodeURIComponent(novo.id)}`, { method: "DELETE" });
          if (!opcoesGravar.substituir) throw new DriveErro("existe", `já existe: ${caminho}`);
        }
        return { criado: true };
      },

      /** PDF e outros binários: envia os bytes sem converter para texto. */
      async gravarBytes(caminho, bytes, opcoesGravar = {}) {
        const { pasta, nome } = separar(caminho);
        const pastaId = await pastaDoCaminho(pasta, true);
        const existentes = await arquivosNomeados(pastaId, nome);
        const tipo = opcoesGravar.tipo || "application/pdf";
        const enc = new TextEncoder();
        if (existentes.length) {
          if (!opcoesGravar.substituir) throw new DriveErro("existe", `já existe: ${caminho}`);
          await chamar(`${ENVIO}/files/${encodeURIComponent(existentes[0].id)}?uploadType=media&fields=id`,
            { method: "PATCH", headers: { "Content-Type": tipo }, body: Uint8Array.from(bytes) });
          return { criado: false };
        }
        const limite = `roni${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
        const cabeca = enc.encode(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
          + `${JSON.stringify({ name: nome, parents: [pastaId], mimeType: tipo })}\r\n`
          + `--${limite}\r\nContent-Type: ${tipo}\r\n\r\n`);
        const cauda = enc.encode(`\r\n--${limite}--`);
        const corpo = new Uint8Array(cabeca.length + bytes.length + cauda.length);
        corpo.set(cabeca, 0);
        corpo.set(bytes, cabeca.length);
        corpo.set(cauda, cabeca.length + bytes.length);
        const novo = await json(`${ENVIO}/files?uploadType=multipart&fields=${encodeURIComponent("id,createdTime")}`,
          { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${limite}` }, body: corpo });
        const todos = await arquivosNomeados(pastaId, nome);
        if (todos.length > 1 && todos[0].id !== novo.id) {
          await chamar(`${BASE}/files/${encodeURIComponent(novo.id)}`, { method: "DELETE" });
          if (!opcoesGravar.substituir) throw new DriveErro("existe", `já existe: ${caminho}`);
        }
        return { criado: true };
      },

      async lerBytes(caminho) {
        const { pasta, nome } = separar(caminho);
        let a = null;
        for (const pastaId of await todasAsPastas(pasta)) {
          [a] = await arquivosNomeados(pastaId, nome);
          if (a) break;
        }
        if (!a) return null;
        const r = await chamar(`${BASE}/files/${encodeURIComponent(a.id)}?alt=media`);
        return new Uint8Array(await r.arrayBuffer());
      },

      /**
       * Converte um .docx em PDF pelo Drive: envia pedindo conversão para Documento do Google,
       * exporta como PDF e apaga o arquivo temporário. Tudo com arquivos criados pelo app.
       */
      async converterDocxParaPdf(bytes, nomeTemporario = "conversao-temporaria") {
        const raizId = await obterRaiz();
        const enc = new TextEncoder();
        const limite = `roni${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
        const docxTipo = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        const cabeca = enc.encode(`--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
          + `${JSON.stringify({ name: nomeTemporario, parents: [raizId],
            mimeType: "application/vnd.google-apps.document" })}\r\n`
          + `--${limite}\r\nContent-Type: ${docxTipo}\r\n\r\n`);
        const cauda = enc.encode(`\r\n--${limite}--`);
        const corpo = new Uint8Array(cabeca.length + bytes.length + cauda.length);
        corpo.set(cabeca, 0);
        corpo.set(bytes, cabeca.length);
        corpo.set(cauda, cabeca.length + bytes.length);
        const doc = await json(`${ENVIO}/files?uploadType=multipart&fields=id`,
          { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${limite}` }, body: corpo });
        try {
          const r = await chamar(`${BASE}/files/${encodeURIComponent(doc.id)}/export`
            + `?mimeType=${encodeURIComponent("application/pdf")}`);
          return new Uint8Array(await r.arrayBuffer());
        } finally {
          try { await chamar(`${BASE}/files/${encodeURIComponent(doc.id)}`, { method: "DELETE" }); }
          catch (_) { /* o temporário fica na lixeira do app: melhor esforço */ }
        }
      },

      localizarRaiz,
      listarCompartilhamentos,
      compartilhar,
      deixarDeCompartilhar,

      async excluir(caminho) {
        const { pasta, nome } = separar(caminho);
        const pastaId = await pastaDoCaminho(pasta, false);
        if (!pastaId) return;
        for (const a of await arquivosNomeados(pastaId, nome)) {
          await chamar(`${BASE}/files/${encodeURIComponent(a.id)}`, { method: "DELETE" });
        }
      },
    };
  }

  return { criarClienteDrive, DriveErro };
});
