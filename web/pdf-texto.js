"use strict";
// Gerador de PDF de texto (design 7): A4, Helvetica, codificação WinAnsi, quebra de linha por
// largura e paginação. Síncrono e determinístico: o mesmo texto gera exatamente os mesmos bytes
// em qualquer aparelho (sem datas nem identificadores aleatórios), o que permite que o hash do
// documento seja o mesmo onde quer que a operação de encerramento seja reaplicada.
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.RoniPdfTexto = api;
})(typeof self !== "undefined" ? self : this, function () {
  const VERSAO_LEIAUTE = "1";

  // Larguras da Helvetica (AFM), em milésimos de em, para os caracteres 32..126.
  const LARGURAS = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  // Helvetica-Bold é um pouco mais larga; esta tabela só precisa ser conservadora.
  const FATOR_NEGRITO = 1.08;

  // Unicode fora do Latin-1 que existe no WinAnsi (cp1252).
  const WINANSI = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
    0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b,
    0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94,
    0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a,
    0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };
  const INVERSO = Object.fromEntries(Object.entries(WINANSI).map(([u, b]) => [b, Number(u)]));

  /** Texto Unicode -> string em que cada caractere é um byte WinAnsi. */
  function paraWinAnsi(texto) {
    let saida = "";
    for (const ch of String(texto)) {
      const cp = ch.codePointAt(0);
      if (cp === 0x09) saida += "  ";
      else if (cp >= 0x20 && cp <= 0x7e) saida += ch;
      else if (cp >= 0xa0 && cp <= 0xff) saida += String.fromCharCode(cp);
      else if (WINANSI[cp] !== undefined) saida += String.fromCharCode(WINANSI[cp]);
      else if (cp === 0x00a0) saida += " ";
      else saida += "?";
    }
    return saida;
  }

  /** Inverso de paraWinAnsi (para extrair o texto em testes e verificações). */
  function deWinAnsi(bytes) {
    let s = "";
    for (const ch of bytes) {
      const b = ch.charCodeAt(0);
      s += (b >= 0x80 && b <= 0x9f && INVERSO[b]) ? String.fromCodePoint(INVERSO[b]) : ch;
    }
    return s;
  }

  const larguraDe = (b) => (b >= 32 && b <= 126 ? LARGURAS[b - 32] : 556);
  function medir(winAnsi, tamanho, negrito) {
    let u = 0;
    for (let i = 0; i < winAnsi.length; i += 1) u += larguraDe(winAnsi.charCodeAt(i));
    return (u / 1000) * tamanho * (negrito ? FATOR_NEGRITO : 1);
  }

  /** Quebra uma linha (WinAnsi) em linhas que cabem em `maximo` pontos. */
  function quebrar(linha, tamanho, negrito, maximo) {
    if (linha === "") return [""];
    const saida = [];
    let atual = "";
    for (const palavra of linha.split(/( +)/)) {
      if (palavra === "") continue;
      if (medir(atual + palavra, tamanho, negrito) <= maximo) { atual += palavra; continue; }
      if (atual.trim() !== "") { saida.push(atual.replace(/ +$/, "")); atual = ""; }
      if (/^ +$/.test(palavra)) continue;
      let resto = palavra;
      while (medir(resto, tamanho, negrito) > maximo) {   // palavra maior que a linha
        let n = resto.length - 1;
        while (n > 1 && medir(resto.slice(0, n), tamanho, negrito) > maximo) n -= 1;
        saida.push(resto.slice(0, n));
        resto = resto.slice(n);
      }
      atual = resto;
    }
    if (atual.trim() !== "" || !saida.length) saida.push(atual.replace(/ +$/, ""));
    return saida;
  }

  const escapar = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const n2 = (n) => (Math.round(n * 100) / 100).toString();

  function utf16Hex(texto) {
    let h = "FEFF";
    for (let i = 0; i < texto.length; i += 1) h += texto.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
    return `<${h}>`;
  }

  /**
   * Gera o PDF. `blocos`: lista de { texto, estilo } em que estilo é "titulo" | "normal" |
   * "negrito" | "nota"; `\n` no texto separa linhas. Devolve Uint8Array.
   */
  function gerar({ titulo = "", blocos = [] } = {}) {
    const LARG = 595.28;
    const ALT = 841.89;
    const MARGEM = 56;
    const util = LARG - 2 * MARGEM;
    const ESTILOS = {
      titulo: { fonte: "F2", tamanho: 16, entre: 22, negrito: true },
      negrito: { fonte: "F2", tamanho: 11, entre: 15, negrito: true },
      normal: { fonte: "F1", tamanho: 11, entre: 15, negrito: false },
      nota: { fonte: "F1", tamanho: 9, entre: 12, negrito: false },
    };

    // linhas já quebradas, com estilo
    const linhas = [];
    for (const bloco of blocos) {
      const e = ESTILOS[bloco.estilo] || ESTILOS.normal;
      for (const crua of String(bloco.texto).split("\n")) {
        for (const l of quebrar(paraWinAnsi(crua), e.tamanho, e.negrito, util)) {
          linhas.push({ texto: l, e });
        }
      }
    }

    // paginação
    const paginas = [[]];
    let y = ALT - MARGEM;
    for (const l of linhas) {
      if (y - l.e.entre < MARGEM && paginas[paginas.length - 1].length) {
        paginas.push([]);
        y = ALT - MARGEM;
      }
      y -= l.e.entre;
      paginas[paginas.length - 1].push({ ...l, y: y + (l.e.entre - l.e.tamanho) / 2 });
    }

    // objetos: 1 catálogo, 2 páginas, 3 F1, 4 F2, 5 info; depois (página, conteúdo) por página
    const objetos = [];
    const filhos = paginas.map((_, i) => `${6 + i * 2} 0 R`).join(" ");
    objetos[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objetos[2] = `<< /Type /Pages /Kids [${filhos}] /Count ${paginas.length} >>`;
    objetos[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    objetos[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
    objetos[5] = `<< /Title ${utf16Hex(titulo)} /Producer (RoniVet leiaute ${VERSAO_LEIAUTE}) >>`;
    paginas.forEach((pag, i) => {
      const idPagina = 6 + i * 2;
      const idConteudo = idPagina + 1;
      let fluxo = "";
      for (const l of pag) {
        fluxo += `BT /${l.e.fonte} ${l.e.tamanho} Tf ${n2(MARGEM)} ${n2(l.y)} Td (${escapar(l.texto)}) Tj ET\n`;
      }
      objetos[idPagina] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n2(LARG)} ${n2(ALT)}] `
        + `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${idConteudo} 0 R >>`;
      objetos[idConteudo] = `<< /Length ${fluxo.length} >>\nstream\n${fluxo}endstream`;
    });

    let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const posicoes = [];
    for (let id = 1; id < objetos.length; id += 1) {
      posicoes[id] = pdf.length;
      pdf += `${id} 0 obj\n${objetos[id]}\nendobj\n`;
    }
    const xref = pdf.length;
    pdf += `xref\n0 ${objetos.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < objetos.length; id += 1) {
      pdf += `${String(posicoes[id]).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objetos.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 0xff;
    return bytes;
  }

  /** Texto do PDF gerado por `gerar` (uma linha por comando Tj), na ordem das páginas. */
  function extrairTexto(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
    const linhas = [];
    const re = /\((?:\\.|[^\\)])*\) Tj/g;
    for (const m of s.matchAll(re)) {
      const interno = m[0].slice(1, -4).replace(/\\([\\()])/g, "$1");
      linhas.push(deWinAnsi(interno));
    }
    return linhas.join("\n");
  }

  /** Quantidade de páginas do PDF gerado por `gerar`. */
  function paginas(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
    const m = /\/Count (\d+)/.exec(s);
    return m ? Number(m[1]) : 0;
  }

  return { gerar, extrairTexto, paginas, paraWinAnsi, VERSAO_LEIAUTE };
});
