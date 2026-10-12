"use strict";
// Drive em memória para testes e simulações (design 5). A "nuvem" é compartilhada; cada
// aparelho usa um cliente próprio, com a mesma interface do cliente REST do Drive:
//   listar(prefixo)            -> [{ caminho, modificadoEm }]   (caminhos lógicos, sem pastas)
//   ler(caminho)               -> string | null
//   gravar(caminho, conteudo, {substituir}) -> cria; recusa se já existe (ExisteErro) sem `substituir`
//   excluir(caminho)
// Falhas que o Drive real tem e a sincronização precisa tolerar: indisponibilidade, listagem
// defasada, arquivo truncado e criação duplicada.
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.RoniDriveMemoria = api;
})(typeof self !== "undefined" ? self : this, function () {
  class ExisteErro extends Error {
    constructor(caminho) { super(`já existe: ${caminho}`); this.codigo = "existe"; }
  }
  class IndisponivelErro extends Error {
    constructor() { super("Drive indisponível (simulado)"); this.codigo = "indisponivel"; }
  }

  function criarNuvem(opcoes = {}) {
    const arquivos = new Map();   // caminho -> { conteudo, criadoEm, modificadoEm, visivelApos }
    let tempo = 0;
    const nuvem = {
      /** Relógio da nuvem (ms); avance com `avancar`. */
      agora: () => tempo,
      avancar(ms) { tempo += ms; },
      /** Atraso até um arquivo novo aparecer nas listagens (a leitura direta já o vê). */
      atrasoDeListagem: opcoes.atrasoDeListagem || 0,
      /** As próximas N chamadas falham como indisponíveis. */
      falhar: 0,
      /** A próxima conversão .docx -> PDF falha. */
      falharConversao: false,
      /** Substitui a conversão simulada: async (bytesDocx) => bytesPdf. */
      conversor: null,
      /** A próxima gravação guarda só os primeiros N caracteres (arquivo truncado). */
      truncarProximaGravacao: null,
      chamadas: 0,
      arquivos,
      caminhos: () => [...arquivos.keys()].sort(),
      cliente(aparelho) {
        const antes = () => {
          nuvem.chamadas += 1;
          if (nuvem.falhar > 0) { nuvem.falhar -= 1; throw new IndisponivelErro(); }
        };
        return {
          aparelho,
          async listar(prefixo = "") {
            antes();
            return [...arquivos.entries()]
              .filter(([c, a]) => c.startsWith(prefixo) && a.visivelApos <= tempo)
              .map(([caminho, a]) => ({ caminho, modificadoEm: a.modificadoEm }))
              .sort((x, y) => (x.caminho < y.caminho ? -1 : 1));
          },
          async ler(caminho) {
            antes();
            return arquivos.has(caminho) ? arquivos.get(caminho).conteudo : null;
          },
          async gravar(caminho, conteudo, opcoesGravar = {}) {
            antes();
            if (arquivos.has(caminho) && !opcoesGravar.substituir) throw new ExisteErro(caminho);
            let guardado = String(conteudo);
            if (nuvem.truncarProximaGravacao !== null) {
              guardado = guardado.slice(0, nuvem.truncarProximaGravacao);
              nuvem.truncarProximaGravacao = null;
            }
            arquivos.set(caminho, { conteudo: guardado, criadoEm: tempo, modificadoEm: tempo,
              visivelApos: tempo + nuvem.atrasoDeListagem, autor: aparelho });
            return { criado: true };
          },
          /** Arquivo binário (PDF): mesma regra de `gravar`. */
          async gravarBytes(caminho, bytes, opcoesGravar = {}) {
            antes();
            if (arquivos.has(caminho) && !opcoesGravar.substituir) throw new ExisteErro(caminho);
            arquivos.set(caminho, { conteudo: Uint8Array.from(bytes), binario: true, criadoEm: tempo,
              modificadoEm: tempo, visivelApos: tempo + nuvem.atrasoDeListagem, autor: aparelho });
            return { criado: true };
          },
          async lerBytes(caminho) {
            antes();
            if (!arquivos.has(caminho)) return null;
            const c = arquivos.get(caminho).conteudo;
            return typeof c === "string" ? Uint8Array.from(Buffer.from(c, "utf8")) : Uint8Array.from(c);
          },
          /** Conversão .docx -> PDF feita pelo Drive (simulada: PDF fixo com o texto do documento). */
          async converterDocxParaPdf(bytes) {
            antes();
            if (nuvem.falharConversao) {
              nuvem.falharConversao = false;
              throw new IndisponivelErro();
            }
            if (nuvem.conversor) return nuvem.conversor(bytes);
            const texto = Buffer.from(bytes).toString("latin1").replace(/[^\x20-\x7e]+/g, " ");
            return Uint8Array.from(Buffer.from(`%PDF-1.4\n%CONVERTIDO\n${texto.slice(0, 4000)}\n%%EOF\n`, "latin1"));
          },
          async excluir(caminho) {
            antes();
            arquivos.delete(caminho);
          },
        };
      },
    };
    return nuvem;
  }

  return { criarNuvem, ExisteErro, IndisponivelErro };
});
