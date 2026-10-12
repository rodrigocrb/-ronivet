"use strict";
// Modelos de documento em .docx (design 7): leitura/gravação de zip, descoberta e preenchimento
// de marcadores {campo}, inclusive os que o Word divide em vários trechos de texto. O restante
// do arquivo (estilos, imagens, cabeçalhos, rodapés, marca d'água) é preservado byte a byte.
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.RoniDocx = api;
})(typeof self !== "undefined" ? self : this, function () {
  // ---------- CRC-32 ----------
  const TABELA = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) c = TABELA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // ---------- deflate (API de streams, presente no WebView e no Node) ----------
  async function fluxo(bytes, transformador) {
    const resposta = new Response(new Blob([bytes]).stream().pipeThrough(transformador));
    return new Uint8Array(await resposta.arrayBuffer());
  }
  const inflar = (b) => fluxo(b, new DecompressionStream("deflate-raw"));
  const deflar = (b) => fluxo(b, new CompressionStream("deflate-raw"));

  const u16 = (v, o) => v[o] | (v[o + 1] << 8);
  const u32 = (v, o) => (v[o] | (v[o + 1] << 8) | (v[o + 2] << 16) | (v[o + 3] << 24)) >>> 0;
  const utf8 = (t) => new TextEncoder().encode(t);
  const texto = (b) => new TextDecoder("utf-8").decode(b);

  /** Lê o zip e devolve Map(nome -> Uint8Array), na ordem do diretório central. */
  async function lerZip(bytes) {
    // fim do diretório central (EOCD)
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
      if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("arquivo .docx inválido (não é um zip)");
    const total = u16(bytes, eocd + 10);
    let pos = u32(bytes, eocd + 16);
    const saida = new Map();
    for (let n = 0; n < total; n += 1) {
      if (u32(bytes, pos) !== 0x02014b50) throw new Error("diretório do zip corrompido");
      const metodo = u16(bytes, pos + 10);
      const tamComp = u32(bytes, pos + 20);
      const nomeLen = u16(bytes, pos + 28);
      const extraLen = u16(bytes, pos + 30);
      const comLen = u16(bytes, pos + 32);
      const local = u32(bytes, pos + 42);
      const nome = texto(bytes.subarray(pos + 46, pos + 46 + nomeLen));
      pos += 46 + nomeLen + extraLen + comLen;
      if (u32(bytes, local) !== 0x04034b50) throw new Error("entrada do zip corrompida");
      const ini = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
      const dados = bytes.subarray(ini, ini + tamComp);
      if (nome.endsWith("/")) { saida.set(nome, new Uint8Array(0)); continue; }
      if (metodo === 0) saida.set(nome, Uint8Array.from(dados));
      else if (metodo === 8) saida.set(nome, await inflar(dados));
      else throw new Error(`método de compressão não suportado: ${metodo}`);
    }
    return saida;
  }

  /** Grava um zip (deflate) a partir de Map(nome -> Uint8Array). */
  async function escreverZip(entradas) {
    const partes = [];
    const central = [];
    let deslocamento = 0;
    for (const [nome, dados] of entradas) {
      const nomeB = utf8(nome);
      const crc = crc32(dados);
      const comp = dados.length ? await deflar(dados) : new Uint8Array(0);
      const usar = comp.length < dados.length ? comp : dados;
      const metodo = usar === comp && dados.length ? 8 : 0;
      const cab = new Uint8Array(30 + nomeB.length);
      const dv = new DataView(cab.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);              // nomes em UTF-8
      dv.setUint16(8, metodo, true);
      dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true);   // data fixa (1980-01-01)
      dv.setUint32(14, crc, true);
      dv.setUint32(18, usar.length, true);
      dv.setUint32(22, dados.length, true);
      dv.setUint16(26, nomeB.length, true);
      dv.setUint16(28, 0, true);
      cab.set(nomeB, 30);
      partes.push(cab, usar);
      const c = new Uint8Array(46 + nomeB.length);
      const cv = new DataView(c.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, metodo, true);
      cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, usar.length, true);
      cv.setUint32(24, dados.length, true);
      cv.setUint16(28, nomeB.length, true);
      cv.setUint32(42, deslocamento, true);
      c.set(nomeB, 46);
      central.push(c);
      deslocamento += cab.length + usar.length;
    }
    const tamCentral = central.reduce((s, c) => s + c.length, 0);
    const fim = new Uint8Array(22);
    const fv = new DataView(fim.buffer);
    fv.setUint32(0, 0x06054b50, true);
    fv.setUint16(8, entradas.size, true);
    fv.setUint16(10, entradas.size, true);
    fv.setUint32(12, tamCentral, true);
    fv.setUint32(16, deslocamento, true);
    const todos = [...partes, ...central, fim];
    const saida = new Uint8Array(todos.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of todos) { saida.set(p, o); o += p.length; }
    return saida;
  }

  // ---------- marcadores no XML do Word ----------
  const MARCADOR = /\{([a-z][a-z0-9_]*)\}/g;
  // parágrafo mais interno: não contém outro <w:p ...> dentro (caixas de texto)
  const PARAGRAFO = /<w:p(?:\s[^>]*)?>(?:(?!<w:p[\s>])[\s\S])*?<\/w:p>/g;
  const TEXTO = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g;
  const PARTES_COM_TEXTO = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

  const desescapar = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  const escapar = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  /** Marcadores {campo} de um XML (um parágrafo por vez, juntando os trechos). */
  function marcadoresDoXml(xml) {
    const achados = new Set();
    for (const p of xml.matchAll(PARAGRAFO)) {
      let corrido = "";
      for (const t of p[0].matchAll(TEXTO)) corrido += desescapar(t[2]);
      for (const m of corrido.matchAll(MARCADOR)) achados.add(m[1]);
    }
    return achados;
  }

  /**
   * Substitui marcadores de um XML. `valores`: { campo: texto }. Devolve { xml, faltam:Set }.
   * O valor entra no trecho em que o marcador começa; as partes seguintes do marcador, que
   * estavam em outros trechos, são removidas. Quebras de linha viram <w:br/>.
   */
  function preencherXml(xml, valores) {
    const faltam = new Set();
    const novo = xml.replace(PARAGRAFO, (paragrafo) => {
      // nós de texto do parágrafo
      const nos = [];
      let ultimo = 0;
      const pecas = [];
      for (const t of paragrafo.matchAll(TEXTO)) {
        pecas.push(paragrafo.slice(ultimo, t.index));
        nos.push({ abre: t[1], texto: desescapar(t[2]), fecha: t[3] });
        pecas.push(null);
        ultimo = t.index + t[0].length;
      }
      pecas.push(paragrafo.slice(ultimo));
      if (!nos.length) return paragrafo;
      const corrido = nos.map((n) => n.texto).join("");
      const casos = [...corrido.matchAll(MARCADOR)];
      if (!casos.length) return paragrafo;

      // mapa: posição no texto corrido -> nó
      const limites = [];
      let acc = 0;
      for (const n of nos) { limites.push([acc, acc + n.texto.length]); acc += n.texto.length; }
      const nodoDe = (pos) => limites.findIndex(([a, b]) => pos >= a && pos < b);

      // de trás para frente, para não deslocar as posições
      for (const m of casos.reverse()) {
        const nome = m[1];
        if (!Object.prototype.hasOwnProperty.call(valores, nome)) { faltam.add(nome); continue; }
        const ini = m.index;
        const fim = ini + m[0].length;
        const primeiro = nodoDe(ini);
        const ultimoNo = nodoDe(fim - 1);
        for (let i = primeiro; i <= ultimoNo; i += 1) {
          const [a, b] = limites[i];
          const de = Math.max(ini, a) - a;
          const ate = Math.min(fim, b) - a;
          const t = nos[i].texto;
          nos[i].texto = t.slice(0, de) + (i === primeiro ? "\u0000" + nome + "\u0000" : "") + t.slice(ate);
        }
      }
      // reconstrói o parágrafo
      let saida = "";
      let k = 0;
      for (const peca of pecas) {
        if (peca !== null) { saida += peca; continue; }
        const n = nos[k++];
        let conteudo = escapar(n.texto);
        conteudo = conteudo.replace(/\u0000([a-z][a-z0-9_]*)\u0000/g, (todo, nome) => {
          if (!Object.prototype.hasOwnProperty.call(valores, nome)) return `{${nome}}`;
          return escapar(valores[nome]).replace(/\r?\n/g, '</w:t><w:br/><w:t xml:space="preserve">');
        });
        let abre = n.abre;
        if (!/xml:space=/.test(abre) && /^\s|\s$| /.test(desescapar(conteudo))) {
          abre = abre.replace(/^<w:t/, '<w:t xml:space="preserve"');
        }
        saida += abre + conteudo + n.fecha;
      }
      return saida;
    });
    return { xml: novo, faltam };
  }

  /** Marcadores usados no modelo (corpo, cabeçalhos, rodapés e notas). */
  async function marcadoresDoDocx(bytes) {
    const zip = await lerZip(bytes);
    if (!zip.has("word/document.xml")) throw new Error("arquivo .docx inválido (sem word/document.xml)");
    const todos = new Set();
    for (const [nome, dados] of zip) {
      if (!PARTES_COM_TEXTO.test(nome)) continue;
      for (const m of marcadoresDoXml(texto(dados))) todos.add(m);
    }
    return [...todos].sort();
  }

  /**
   * Preenche o modelo. `valores`: { campo: texto }. Falha (Error com `.faltam`) se algum
   * marcador do modelo não tiver valor. Devolve os bytes do novo .docx.
   */
  async function preencherDocx(bytes, valores) {
    const zip = await lerZip(bytes);
    if (!zip.has("word/document.xml")) throw new Error("arquivo .docx inválido (sem word/document.xml)");
    const faltam = new Set();
    const saida = new Map();
    for (const [nome, dados] of zip) {
      if (PARTES_COM_TEXTO.test(nome)) {
        const r = preencherXml(texto(dados), valores);
        for (const f of r.faltam) faltam.add(f);
        saida.set(nome, utf8(r.xml));
      } else {
        saida.set(nome, dados);
      }
    }
    if (faltam.size) {
      const e = new Error(`marcadores sem valor: ${[...faltam].sort().join(", ")}`);
      e.faltam = [...faltam].sort();
      throw e;
    }
    return escreverZip(saida);
  }

  /**
   * Documento .docx inicial: um parágrafo por linha (a primeira é o título, em negrito).
   * Arquivo OOXML mínimo, aceito pelo Word, Google Docs e LibreOffice; a clínica o edita à vontade
   * e envia de volta, mantendo os marcadores {campo}.
   */
  async function gerarDocxInicial(linhas) {
    const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const paragrafo = (t, negrito) => (t === ""
      ? "<w:p/>"
      : `<w:p><w:r>${negrito ? "<w:rPr><w:b/><w:sz w:val=\"32\"/></w:rPr>" : ""}`
        + `<w:t xml:space="preserve">${escapar(t)}</w:t></w:r></w:p>`);
    const corpo = linhas.map((l, i) => paragrafo(l, i === 0)).join("");
    const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<w:document xmlns:w="${NS_W}"><w:body>${corpo}`
      + `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>`
      + `<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/>`
      + `</w:sectPr></w:body></w:document>`;
    const tipos = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
      + `<Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/word/document.xml" `
      + `ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`
      + `</Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" `
      + `Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" `
      + `Target="word/document.xml"/></Relationships>`;
    return escreverZip(new Map([
      ["[Content_Types].xml", utf8(tipos)],
      ["_rels/.rels", utf8(rels)],
      ["word/document.xml", utf8(documento)],
    ]));
  }

  return { lerZip, escreverZip, marcadoresDoDocx, preencherDocx, marcadoresDoXml, preencherXml,
    gerarDocxInicial, crc32 };
});
