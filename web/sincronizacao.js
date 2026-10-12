"use strict";
// Sincronização pelo Drive (design 5): cada aparelho publica lotes imutáveis e numerados das
// próprias operações e lê os lotes dos outros. Nunca altera arquivo existente; cada aparelho
// grava só na própria pasta, então não há disputa de escrita.
//
//   operacoes/<aparelho>/lote-000001.json   { formato, aparelho, seq, operacoes, sha256 }
//   aparelhos/<aparelho>.json               { aparelho, nome, promessa }  (reescrito pelo dono)
//   instantaneos/inst-<t>-<c>-<aparelho>.json  { ate, tabelas, sha256 }   (estado estável)
//   retirados/<aparelho>.json               { aparelho, em, por, motivo, ultimoLote }
//     Aparelho retirado: apaga o banco local ao ler este arquivo, não conta no ponto estável e só
//     tem os lotes até `ultimoLote` considerados (os mesmos em todos os aparelhos).
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === "object" && module.exports) module.exports = api;
  else raiz.RoniSincronizacao = api;
})(typeof self !== "undefined" ? self : this, function () {
  const FORMATO_LOTE = "ronivet-lote-1";
  const ARQ_SYNC = "registro/sync";
  const PREFIXO = "operacoes/";
  const FORMATO_APARELHO = "ronivet-aparelho-1";
  const FORMATO_INSTANTANEO = "ronivet-instantaneo-1";
  const FORMATO_RETIRADO = "ronivet-retirado-1";
  const comparar = (a, b) => {
    if (a.t !== b.t) return a.t < b.t ? -1 : 1;
    if (a.c !== b.c) return a.c < b.c ? -1 : 1;
    return a.aparelho === b.aparelho ? 0 : (a.aparelho < b.aparelho ? -1 : 1);
  };
  const pad = (n, t) => String(n).padStart(t, "0");
  const nomeInstantaneo = (m) => `instantaneos/inst-${pad(m.t, 15)}-${pad(m.c, 6)}-${m.aparelho}.json`;

  const nomeLote = (seq) => `lote-${String(seq).padStart(6, "0")}.json`;
  const caminhoLote = (aparelho, seq) => `${PREFIXO}${aparelho}/${nomeLote(seq)}`;
  const CAMPOS_OP = ["id", "t", "c", "aparelho", "hora", "email", "metodo", "caminho", "corpo"];
  const soOp = (o) => Object.fromEntries(CAMPOS_OP.map((k) => [k, o[k] === undefined ? null : o[k]]));

  /**
   * opcoes: { motor, repo, drive, aparelho, sha256, tamanhoLote }
   * `drive` é o cliente (listar/ler/gravar). `repo.descarregar()` grava de forma durável.
   */
  function criarSincronizador(opcoes) {
    const { motor, repo, drive, aparelho, sha256 } = opcoes;
    const tamanhoLote = opcoes.tamanhoLote || 200;

    const estado = repo.existeArquivo(ARQ_SYNC)
      ? JSON.parse(repo.lerArquivo(ARQ_SYNC))
      : { proximoLote: 1, emEnvio: null, lidos: [], documentos: [] };
    const lidos = new Set(estado.lidos);
    const docsPublicados = new Set(estado.documentos || []);
    const salvar = () => repo.gravarArquivo(ARQ_SYNC, JSON.stringify(
      { proximoLote: estado.proximoLote, emEnvio: estado.emEnvio, lidos: [...lidos],
        documentos: [...docsPublicados] }));

    /** Publica as operações pendentes, em lotes. Devolve a quantidade publicada. */
    async function publicar(resultado) {
      let publicadas = 0;
      for (;;) {
        if (!estado.emEnvio) {
          const pend = motor.pendentesDeEnvio().slice(0, tamanhoLote);
          if (!pend.length) {
            // Nada pendente: tudo o que este aparelho tem até aqui está no Drive. A marca é lida
            // no mesmo instante (sem espera), então nenhuma operação nova fica antes dela.
            resultado.promessa = motor.prometer();
            break;
          }
          // Fixa o conteúdo do lote antes do envio: uma repetição reenvia o mesmo lote.
          estado.emEnvio = { seq: estado.proximoLote, operacoes: pend.map(soOp) };
          salvar();
          await repo.descarregar();
        }
        const { seq, operacoes } = estado.emEnvio;
        const caminho = caminhoLote(aparelho, seq);
        const conteudo = JSON.stringify({ formato: FORMATO_LOTE, aparelho, seq, operacoes,
          sha256: sha256(JSON.stringify(operacoes)) });
        // O lote é do próprio aparelho: se já existe (tentativa anterior) ou ficou truncado,
        // é regravado por cima e relido para conferir antes de dar a operação como publicada.
        let atual = null;
        try {
          await drive.gravar(caminho, conteudo);
        } catch (e) {
          if (!e || e.codigo !== "existe") throw e;
        }
        atual = await drive.ler(caminho);
        if (atual !== conteudo) {
          await drive.gravar(caminho, conteudo, { substituir: true });
          if ((await drive.ler(caminho)) !== conteudo) {
            throw new Error("o Drive não confirmou o lote gravado");
          }
        }
        motor.marcarPublicadas(operacoes.map((o) => o.id));
        publicadas += operacoes.length;
        estado.emEnvio = null;
        estado.proximoLote = seq + 1;
        salvar();
        await repo.descarregar();
      }
      return publicadas;
    }

    function validarLote(caminho, texto) {
      const m = /^operacoes\/([^/]+)\/lote-(\d{6})\.json$/.exec(caminho);
      if (!m) return { erro: "nome de lote inválido" };
      let l;
      try { l = JSON.parse(texto); } catch (_) { return { erro: "lote ilegível (truncado?)" }; }
      if (!l || l.formato !== FORMATO_LOTE) return { erro: "formato de lote desconhecido" };
      if (l.aparelho !== m[1] || l.seq !== Number(m[2])) return { erro: "lote não confere com o nome" };
      if (!Array.isArray(l.operacoes)) return { erro: "lote sem operações" };
      if (sha256(JSON.stringify(l.operacoes)) !== l.sha256) return { erro: "hash do lote não confere" };
      if (l.operacoes.some((o) => !o || o.aparelho !== l.aparelho)) {
        return { erro: "operação de outro aparelho no lote" };
      }
      return { lote: l };
    }

    /** Lê lotes novos dos outros aparelhos e os aplica. */
    async function ler(resultado) {
      const todos = await drive.listar(PREFIXO);
      const retirados = await lerRetirados();
      const alemDoUltimo = (c) => {
        const m = /^operacoes\/([^/]+)\/lote-(\d{6})\.json$/.exec(c);
        const r = m && retirados.get(m[1]);
        return Boolean(r && Number(m[2]) > r.ultimoLote);
      };
      const novos = todos.map((a) => a.caminho)
        .filter((c) => !lidos.has(c) && !c.startsWith(`${PREFIXO}${aparelho}/`) && !alemDoUltimo(c))
        .sort();
      for (const caminho of novos) {
        const texto = await drive.ler(caminho);
        if (texto === null) continue;   // ainda não visível: tenta na próxima
        const v = validarLote(caminho, texto);
        if (v.erro) {
          resultado.erros.push({ caminho, motivo: v.erro });
          continue;                     // não marca como lido: será relido
        }
        const r = motor.receber(v.lote.operacoes);
        resultado.recebidas += r.novas;
        resultado.reconstruiu = resultado.reconstruiu || r.reconstruiu;
        resultado.mudaram.push(...r.mudaram);
        resultado.lotesLidos += 1;
        lidos.add(caminho);
        salvar();
        await repo.descarregar();
      }
    }

    /** Um ciclo: publica e lê. Falhas do Drive viram `erros`; nada fica pela metade. */
    async function ciclo() {
      const resultado = { publicadas: 0, lotesLidos: 0, recebidas: 0, reconstruiu: false,
        mudaram: [], erros: [] };
      try {
        const eu = (await lerRetirados()).get(aparelho);
        if (eu) {   // retirado: não envia nem lê nada; o aplicativo apaga o banco local
          resultado.retirado = eu;
          if (opcoes.aoSerRetirado) await opcoes.aoSerRetirado(eu);
          return resultado;
        }
      } catch (e) {
        resultado.erros.push({ etapa: "retirada", motivo: String(e && e.message || e),
          codigo: e && e.codigo });
        return resultado;   // sem saber se foi retirado, não envia
      }
      try {
        resultado.publicadas = await publicar(resultado);
      } catch (e) {
        resultado.erros.push({ etapa: "publicar", motivo: String(e && e.message || e),
          codigo: e && e.codigo });
    }
    try {
      await ler(resultado);
    } catch (e) {
      resultado.erros.push({ etapa: "ler", motivo: String(e && e.message || e),
        codigo: e && e.codigo });
    }
    if (resultado.promessa && !resultado.erros.length) {
      try {
        await registrarAparelho(resultado.promessa);
        if (opcoes.instantaneoACada) {
          resultado.instantaneo = await publicarInstantaneo(opcoes.instantaneoACada);
        }
      } catch (e) {
        resultado.erros.push({ etapa: "registro", motivo: String(e && e.message || e),
          codigo: e && e.codigo });
      }
    }
    if (opcoes.aposCiclo) {   // ex.: gerar os documentos pendentes (precisa de conexão)
      try {
        await opcoes.aposCiclo(resultado);
      } catch (e) {
        resultado.erros.push({ etapa: "apos_ciclo", motivo: String(e && e.message || e),
          codigo: e && e.codigo });
      }
    }
    return resultado;
  
    }

    // ---------- aparelhos e instantâneos ----------

    /** Publica (reescreve) o registro deste aparelho com a promessa de ordem. */
    async function registrarAparelho(promessa) {
      const caminho = `aparelhos/${aparelho}.json`;
      const conteudo = JSON.stringify({ formato: FORMATO_APARELHO, aparelho,
        nome: (typeof opcoes.nome === "function" ? opcoes.nome() : opcoes.nome) || aparelho,
        versao: opcoes.versaoApp || null, promessa });
      try {
        await drive.gravar(caminho, conteudo);
      } catch (e) {
        if (!e || e.codigo !== "existe") throw e;
        await drive.gravar(caminho, conteudo, { substituir: true });
      }
    }

    async function lerAparelhos() {
      const lista = [];
      for (const a of await drive.listar("aparelhos/")) {
        const texto = await drive.ler(a.caminho);
        if (texto === null) continue;
        try {
          const o = JSON.parse(texto);
          if (o && o.formato === FORMATO_APARELHO && o.aparelho) lista.push(o);
        } catch (_) { /* ignora registro ilegível */ }
      }
      return lista;
    }

    /** Aparelhos retirados: Map(aparelho -> { em, por, motivo, ultimoLote }). */
    async function lerRetirados() {
      const mapa = new Map();
      for (const a of await drive.listar("retirados/")) {
        const texto = await drive.ler(a.caminho);
        if (texto === null) continue;
        try {
          const o = JSON.parse(texto);
          if (o && o.formato === FORMATO_RETIRADO && o.aparelho) {
            mapa.set(o.aparelho, { aparelho: o.aparelho, em: o.em, por: o.por, motivo: o.motivo,
              ultimoLote: Number(o.ultimoLote) || 0 });
          }
        } catch (_) { /* ignora registro ilegível */ }
      }
      return mapa;
    }

    /**
     * Retira um aparelho (ex.: perdido). Fixa até que lote suas operações valem e o tira do ponto
     * estável. Idempotente: a primeira retirada vale.
     */
    async function retirar(id, { por, motivo, em } = {}) {
      if (!id || id === aparelho) throw new Error("não é possível retirar o próprio aparelho");
      const retirados = await lerRetirados();
      if (retirados.has(id)) return retirados.get(id);
      let ultimo = 0;
      for (const a of await drive.listar(`${PREFIXO}${id}/`)) {
        const m = /lote-(\d{6})\.json$/.exec(a.caminho);
        if (m) ultimo = Math.max(ultimo, Number(m[1]));
      }
      const registro = { formato: FORMATO_RETIRADO, aparelho: id, em: em || null, por: por || null,
        motivo: motivo || null, ultimoLote: ultimo };
      try {
        await drive.gravar(`retirados/${id}.json`, JSON.stringify(registro));
      } catch (e) {
        if (!e || e.codigo !== "existe") throw e;   // outro aparelho retirou ao mesmo tempo
      }
      return (await lerRetirados()).get(id) || registro;
    }

    /** Menor promessa entre os aparelhos ativos: o que é estável para todos. */
    async function pontoEstavel() {
      const retirados = await lerRetirados();
      const aparelhos = (await lerAparelhos()).filter((a) => !retirados.has(a.aparelho));
      if (!aparelhos.length || aparelhos.some((a) => !a.promessa)) return null;
      let menor = aparelhos[0].promessa;
      for (const a of aparelhos) if (comparar(a.promessa, menor) < 0) menor = a.promessa;
      return menor;
    }

    async function listarInstantaneos() {
      const validos = [];
      for (const a of await drive.listar("instantaneos/")) {
        const texto = await drive.ler(a.caminho);
        if (texto === null) continue;
        try {
          const i = JSON.parse(texto);
          if (i && i.formato === FORMATO_INSTANTANEO && i.ate && i.tabelas
            && sha256(JSON.stringify(i.tabelas)) === i.sha256) validos.push({ caminho: a.caminho, ...i });
        } catch (_) { /* truncado: ignora */ }
      }
      return validos.sort((x, y) => comparar(x.ate, y.ate));
    }

    /** Publica um instantâneo no ponto estável se houver `minimo` operações novas desde o último. */
    async function publicarInstantaneo(minimo = 1) {
      const ate = await pontoEstavel();
      if (!ate) return null;
      const existentes = await listarInstantaneos();
      const ultimo = existentes.length ? existentes[existentes.length - 1].ate : null;
      const noPonto = motor.operacoes().filter((o) => comparar(o, ate) <= 0
        && (!ultimo || comparar(o, ultimo) > 0));
      if (!noPonto.length || noPonto.length < minimo) return null;
      const tabelas = motor.estadoAte(ate);
      const caminho = nomeInstantaneo(ate);
      const conteudo = JSON.stringify({ formato: FORMATO_INSTANTANEO, criadoPor: aparelho, ate,
        tabelas, sha256: sha256(JSON.stringify(tabelas)) });
      try {
        await drive.gravar(caminho, conteudo);
      } catch (e) {
        if (!e || e.codigo !== "existe") throw e;   // outro aparelho publicou o mesmo ponto
      }
      return { caminho, ate, operacoes: noPonto.length };
    }

    /**
     * Publica o estado-base (o de antes das operações deste aparelho) como primeiro instantâneo,
     * para que os demais aparelhos entrem a partir dele e leiam as operações depois. Só se ainda
     * não há instantâneo e este aparelho não entrou por instantâneo.
     */
    async function publicarBase() {
      if (motor.corte()) return null;   // aparelho que entrou por instantâneo não é a origem da clínica
      if ((await listarInstantaneos()).length) return null;
      const ate = { t: 0, c: 0, aparelho: "base" };
      const tabelas = motor.estadoAte(ate);
      const caminho = nomeInstantaneo(ate);
      await drive.gravar(caminho, JSON.stringify({ formato: FORMATO_INSTANTANEO,
        criadoPor: aparelho, ate, tabelas, sha256: sha256(JSON.stringify(tabelas)) }));
      return { caminho, ate };
    }

    /**
     * Aparelho novo: adota o instantâneo mais recente e lê as operações seguintes.
     * Só vale com o registro local vazio. Devolve { instantaneo, ... } do ciclo.
     */
    async function entrar() {
      // Primeiro se registra: a partir daí nenhum instantâneo novo passa à frente das operações
      // deste aparelho (a menor promessa inclui a dele). Depois lê os instantâneos existentes.
      await registrarAparelho(motor.prometer());
      const lista = await listarInstantaneos();
      let adotado = null;
      if (lista.length && motor.totalDeOperacoes() === 0) {
        const ultimo = lista[lista.length - 1];
        motor.iniciarDeInstantaneo({ tabelas: ultimo.tabelas, ate: ultimo.ate });
        await repo.descarregar();
        adotado = ultimo.caminho;
      }
      const r = await ciclo();
      r.instantaneo = adotado;
      return r;
    }

    return {
      entrar,
      publicarInstantaneo,
      publicarBase,
      pontoEstavel,
      lerAparelhos,
      lerRetirados,
      retirar,
      sincronizar: ciclo,
      estado: () => ({ proximoLote: estado.proximoLote, emEnvio: estado.emEnvio,
        lidos: lidos.size }),
    };
  }

  return { criarSincronizador, caminhoLote, FORMATO_LOTE };
});
