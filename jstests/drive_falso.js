"use strict";
// Servidor falso da API REST do Google Drive v3 (somente o que o cliente usa), em memória.
// `fetchImpl(url, init)` tem a assinatura de fetch.
const PASTA = "application/vnd.google-apps.folder";

function criarDriveFalso() {
  const arquivos = new Map();
  let n = 0;
  let tempo = Date.parse("2026-10-12T10:00:00Z");
  const iso = () => new Date(tempo++).toISOString();
  const estado = { chamadas: [], falhas: [], tokens: new Set(), tokenValido: "tok-1" };

  const resposta = (status, corpo) => ({
    ok: status >= 200 && status < 300, status,
    json: async () => (typeof corpo === "string" ? JSON.parse(corpo) : corpo),
    text: async () => (typeof corpo === "string" ? corpo
      : (corpo instanceof Uint8Array ? Buffer.from(corpo).toString("utf8") : JSON.stringify(corpo))),
    arrayBuffer: async () => {
      const b = corpo instanceof Uint8Array ? corpo : Buffer.from(String(corpo), "utf8");
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  });
  const erro = (status, reason) => resposta(status, { error: { code: status,
    errors: [{ reason }], status: reason } });

  function novo(meta, conteudo) {
    n += 1;
    const f = { id: `id-${n}`, name: meta.name, mimeType: meta.mimeType || "text/plain",
      parents: meta.parents || [], properties: meta.properties || {}, permissoes: [], createdTime: iso(), modifiedTime: null, content: conteudo || "",
      trashed: false };
    f.modifiedTime = f.createdTime;
    arquivos.set(f.id, f);
    return f;
  }
  const publico = (f, campos) => {
    const base = { id: f.id, name: f.name, mimeType: f.mimeType, createdTime: f.createdTime,
      modifiedTime: f.modifiedTime };
    if (!campos) return { id: f.id };
    return base;
  };

  function filtrar(q) {
    // `properties has { key='k' and value='v' }` contém " and ": extrai antes de dividir
    const props = [];
    q = q.replace(/properties has \{ key='([^']*)' and value='([^']*)' \}/g, (_, k, v) => {
      props.push([k, v]);
      return "";
    }).replace(/(\s+and\s*)+$/, "").replace(/^\s*and\s+/, "");
    const clausulas = q.split(" and ").map((c) => c.trim()).filter(Boolean);
    return [...arquivos.values()].filter((f) => clausulas.every((c) => {
      let m;
      if ((m = /^'(.+)' in parents$/.exec(c))) return f.parents.includes(m[1].replace(/\\'/g, "'"));
      if ((m = /^name = '(.*)'$/.exec(c))) return f.name === m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      if ((m = /^mimeType = '(.+)'$/.exec(c))) return f.mimeType === m[1];
      if ((m = /^mimeType != '(.+)'$/.exec(c))) return f.mimeType !== m[1];
      if (c === "trashed = false") return !f.trashed;
      throw new Error(`consulta não suportada no falso: ${c}`);
    }) && props.every(([k, v]) => f.properties && f.properties[k] === v));
  }

  /** Corpo binário (Uint8Array) -> string "latin1", preservando cada byte. */
  const comoLatin1 = (b) => Buffer.from(b).toString("latin1");
  const dobraBytes = (conteudo) => (typeof conteudo === "string" ? Buffer.from(conteudo, "utf8")
    : Buffer.from(conteudo));

  function lerMultipart(corpo) {
    const m = /^--(\S+)\r\n/.exec(corpo);
    const partes = corpo.split(`--${m[1]}`).filter((p) => p.trim() && p.trim() !== "--");
    const [metaTxt] = partes[0].split("\r\n\r\n").slice(1);
    const conteudo = partes[1].split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, "");
    return { meta: JSON.parse(metaTxt.trim()), conteudo };
  }

  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const metodo = (init.method || "GET").toUpperCase();
    estado.chamadas.push(`${metodo} ${u.pathname}${u.search.slice(0, 60)}`);
    const auth = (init.headers || {}).Authorization;
    if (auth !== `Bearer ${estado.tokenValido}`) return erro(401, "authError");
    if (estado.falhas.length) {
      const f = estado.falhas.shift();
      if (f === "rede") throw new TypeError("Failed to fetch");
      return erro(f.status, f.reason || "backendError");
    }
    const caminho = u.pathname;

    if (caminho === "/drive/v3/files" && metodo === "GET") {
      const lista = filtrar(u.searchParams.get("q") || "").sort((a, b) => (a.id < b.id ? -1 : 1));
      return resposta(200, { files: lista.map((f) => publico(f, true)) });
    }
    if (caminho === "/drive/v3/files" && metodo === "POST") {
      const meta = JSON.parse(init.body);
      return resposta(200, publico(novo(meta, ""), true));
    }
    if (caminho === "/upload/drive/v3/files" && metodo === "POST") {
      const binario = typeof init.body !== "string";
      const { meta, conteudo } = lerMultipart(binario ? Buffer.from(init.body).toString("latin1") : init.body);
      if (binario && meta.name) meta.name = Buffer.from(meta.name, "latin1").toString("utf8");
      return resposta(200, publico(novo(meta, binario ? Uint8Array.from(Buffer.from(conteudo, "latin1")) : conteudo), true));
    }
    let m = /^\/drive\/v3\/files\/([^/]+)\/permissions(?:\/([^/]+))?$/.exec(caminho);
    if (m) {
      const f = arquivos.get(m[1]);
      if (!f) return erro(404, "notFound");
      if (!m[2] && metodo === "GET") {
        return resposta(200, { permissions: [
          { id: "dono", emailAddress: "dono@clinica.com", role: "owner", type: "user" },
          ...f.permissoes] });
      }
      if (!m[2] && metodo === "POST") {
        const p = JSON.parse(init.body);
        n += 1;
        const nova = { id: `perm-${n}`, emailAddress: p.emailAddress, role: p.role, type: p.type };
        f.permissoes.push(nova);
        estado.compartilhadas = (estado.compartilhadas || []).concat([p.emailAddress]);
        return resposta(200, { id: nova.id });
      }
      if (m[2] && metodo === "DELETE") {
        f.permissoes = f.permissoes.filter((x) => x.id !== m[2]);
        return resposta(204, "");
      }
    }
    m = /^\/drive\/v3\/files\/([^/]+)\/export$/.exec(caminho);
    if (m && metodo === "GET") {
      const f = arquivos.get(m[1]);
      if (!f) return erro(404, "notFound");
      if (f.mimeType !== "application/vnd.google-apps.document") return erro(403, "fileNotExportable");
      if (u.searchParams.get("mimeType") !== "application/pdf") return erro(400, "badRequest");
      return resposta(200, Uint8Array.from(Buffer.from(`%PDF-1.4\n%EXPORTADO\n${Buffer.from(f.content).toString("latin1").replace(/[^ -~]+/g, " ").slice(0, 3000)}`, "latin1")));
    }
    m = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(caminho);
    if (m && metodo === "PATCH") {
      const f = arquivos.get(m[1]);
      if (!f) return erro(404, "notFound");
      f.content = typeof init.body === "string" ? init.body : Uint8Array.from(init.body);
      f.modifiedTime = iso();
      return resposta(200, { id: f.id });
    }
    m = /^\/drive\/v3\/files\/([^/]+)$/.exec(caminho);
    if (m) {
      const f = arquivos.get(m[1]);
      if (!f) return erro(404, "notFound");
      if (metodo === "GET" && u.searchParams.get("alt") === "media") return resposta(200, f.content);
      if (metodo === "DELETE") { arquivos.delete(f.id); return resposta(204, ""); }
      if (metodo === "PATCH") {
        const add = u.searchParams.get("addParents");
        const rem = u.searchParams.get("removeParents");
        if (rem) f.parents = f.parents.filter((p) => p !== rem);
        if (add) f.parents.push(add);
        return resposta(200, { id: f.id });
      }
    }
    return erro(404, "notFound");
  }

  return { fetchImpl, arquivos, estado,
    nomes: () => [...arquivos.values()].filter((f) => f.mimeType !== PASTA).map((f) => f.name),
    pastas: () => [...arquivos.values()].filter((f) => f.mimeType === PASTA) };
}

module.exports = { criarDriveFalso };
