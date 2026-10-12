"use strict";
// Ambiente do núcleo dentro do aparelho (design 2): o relógio e os identificadores novos de
// uma operação dependem só da própria operação (idOp e hora de origem), nunca do aparelho que a
// executa nem do momento. Assim, aplicar a mesma operação em qualquer aparelho dá os mesmos
// dados, inclusive os ids gerados. Também traz SHA-256 e base64 síncronos (a interface do
// núcleo é síncrona; WebCrypto não é).
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.RoniAmbienteLocal = api;
})(typeof self !== "undefined" ? self : this, function () {
  // ---------- SHA-256 (FIPS 180-4) ----------
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

  /** Texto (UTF-8) ou bytes -> Uint8Array. */
  function bytes(entrada) {
    if (entrada instanceof Uint8Array) return entrada;
    if (typeof entrada === "string") {
      if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(entrada);
      const u = unescape(encodeURIComponent(entrada));
      const b = new Uint8Array(u.length);
      for (let i = 0; i < u.length; i += 1) b[i] = u.charCodeAt(i);
      return b;
    }
    if (entrada && entrada.buffer instanceof ArrayBuffer) {
      return new Uint8Array(entrada.buffer, entrada.byteOffset, entrada.byteLength);
    }
    if (Array.isArray(entrada)) return Uint8Array.from(entrada);
    throw new TypeError("conteúdo inválido para hash");
  }

  function sha256(entrada) {
    const dados = bytes(entrada);
    const n = dados.length;
    const total = (((n + 9 + 63) >> 6) << 6);
    const bloco = new Uint8Array(total);
    bloco.set(dados);
    bloco[n] = 0x80;
    const dv = new DataView(bloco.buffer);
    dv.setUint32(total - 8, Math.floor((n * 8) / 0x100000000));
    dv.setUint32(total - 4, (n * 8) >>> 0);
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    const rotr = (x, c) => (x >>> c) | (x << (32 - c));
    for (let i = 0; i < total; i += 64) {
      for (let t = 0; t < 16; t += 1) w[t] = dv.getUint32(i + t * 4);
      for (let t = 16; t < 64; t += 1) {
        const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let t = 0; t < 64; t += 1) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + S1 + ch + K[t] + w[t]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (S0 + mj) >>> 0;
        hh = g; g = f; f = e; e = (d + t1) >>> 0;
        d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    return Array.from(h, (x) => x.toString(16).padStart(8, "0")).join("");
  }

  // ---------- base64 ----------
  const ALFA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function paraBase64(entrada) {
    const b = bytes(entrada);
    let s = "";
    for (let i = 0; i < b.length; i += 3) {
      const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
      s += ALFA[(n >> 18) & 63] + ALFA[(n >> 12) & 63]
        + (i + 1 < b.length ? ALFA[(n >> 6) & 63] : "=")
        + (i + 2 < b.length ? ALFA[n & 63] : "=");
    }
    return s;
  }

  function deBase64(texto) {
    const limpo = String(texto).replace(/[^A-Za-z0-9+/]/g, "");
    const saida = new Uint8Array(Math.floor((limpo.length * 3) / 4));
    let o = 0;
    for (let i = 0; i < limpo.length; i += 4) {
      const n = (ALFA.indexOf(limpo[i]) << 18) | (ALFA.indexOf(limpo[i + 1]) << 12)
        | ((ALFA.indexOf(limpo[i + 2]) & 63) << 6) | (ALFA.indexOf(limpo[i + 3]) & 63);
      if (o < saida.length) saida[o++] = (n >> 16) & 255;
      if (o < saida.length) saida[o++] = (n >> 8) & 255;
      if (o < saida.length) saida[o++] = n & 255;
    }
    return saida;
  }

  // ---------- ambiente determinístico ----------

  /**
   * `documentos`: porta de geração de documento do núcleo (amb.documentos).
   * Fora de `executarComo`, `agora()` e `novoId()` recusam: toda execução tem uma operação.
   */
  function criarAmbienteLocal(opcoes) {
    const documentos = (opcoes && opcoes.documentos) || {};
    let atual = null;
    const exigir = () => {
      if (!atual) throw new Error("ambiente usado fora de uma operação (use executarComo)");
      return atual;
    };
    return {
      sha256,
      paraBase64,
      deBase64,
      documentos,
      // O aparelho não gera o PDF no encerramento: o documento é gerado depois (Drive).
      documentoPosterior: true,
      agora: () => exigir().hora,
      /** Aparelho que originou a operação (o mesmo em toda reexecução dela). */
      aparelho: () => exigir().aparelho || null,
      novoId() {
        const o = exigir();
        o.contador += 1;
        const h = sha256(`${o.idOp}:${o.contador}`);
        // formato de UUID v4 derivado do hash (estável e reconhecível)
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
      },
      /** Executa `fn` com o contexto da operação: { idOp, hora (ISO de origem) }. */
      executarComo(operacao, fn) {
        if (atual) throw new Error("operações não podem ser aninhadas");
        atual = { idOp: String(operacao.idOp), hora: operacao.hora, aparelho: operacao.aparelho || null,
          contador: 0 };
        try {
          return fn();
        } finally {
          atual = null;
        }
      },
    };
  }

  return { criarAmbienteLocal, sha256, paraBase64, deBase64 };
});
