/* Execução de operações: exclusão mútua, idempotência por id de operação e diário que
 * garante "tudo ou nada" mesmo sem transações (design 3 e 4).
 *
 * Fluxo de uma gravação, sempre dentro da trava:
 *   1. reverte operações EM_ANDAMENTO deixadas por execuções interrompidas;
 *   2. se o id da operação já foi CONCLUIDA, devolve o resultado guardado;
 *   3. executa o tratador contra uma unidade de trabalho (nada é gravado ainda);
 *   4. grava no diário (EM_ANDAMENTO + mutações que desfazem), aplica as mutações e marca
 *      CONCLUIDA com o resultado. Falha ao aplicar: desfaz e marca REVERTIDA. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};

(function (R) {
  "use strict";

  /** Limite prático de uma célula de planilha é 50.000 caracteres. */
  const LIMITE_DIARIO = 45000;
  /** Tabelas cujas gravações não alteram os dados (não mudam a versão do cache offline). */

  function recuperarInterrompidas(repo, amb) {
    const pendentes = repo.ler("Operacao").filter((o) => o.estado === "EM_ANDAMENTO");
    for (const op of pendentes) {
      const desfazer = JSON.parse(op.desfazer || "[]");
      repo.aplicar(desfazer, { tolerante: true });
      repo.aplicar([{ tabela: "Operacao", tipo: "atualizar", chave: { id_op: op.id_op },
        mudancas: { estado: "REVERTIDA", desfazer: "", concluido_em: amb.agora() } }]);
    }
  }

  function compensar(tx) {
    for (const fn of tx.compensacoes().reverse()) {
      try { fn(); } catch (_) { /* melhor esforço */ }
    }
  }

  /**
   * Grava as mutações da unidade de trabalho com diário e reversão. `resultado` é o que fica
   * guardado para idempotência. Lança HttpErro 500/413 se não for possível gravar.
   */
  function persistir(repo, amb, tx, idOp, usuarioEmail, previa, resultado) {
    const mutacoes = tx.mutacoes();
    const inversas = R.inverterMutacoes(mutacoes);
    const desfazer = JSON.stringify(inversas);
    if (desfazer.length > LIMITE_DIARIO) {
      compensar(tx);
      throw R.erro(413, { codigo: "operacao_muito_grande",
        mensagem: "A operação é grande demais para ser gravada de uma vez." });
    }

    const linhaDiario = { id_op: idOp, estado: "EM_ANDAMENTO", usuario_email: usuarioEmail || null,
      resultado: "", desfazer, criado_em: amb.agora(), concluido_em: null };
    // Resposta com segredo (ex.: código de convite) não vai para a planilha: um reenvio recebe
    // um aviso em vez do segredo.
    const paraGuardar = resultado && resultado.naoGuardar
      ? { status: 409, corpo: { detail: { codigo: "resposta_nao_guardada",
        mensagem: "A operação já foi concluída e a resposta não é guardada por conter um segredo. "
          + "Crie um novo registro se precisar de outro código." } } }
      : { status: resultado.status, corpo: resultado.corpo };
    repo.aplicar(previa
      ? [{ tabela: "Operacao", tipo: "atualizar", chave: { id_op: idOp }, mudancas: linhaDiario }]
      : [{ tabela: "Operacao", tipo: "inserir", linha: R.completarLinha("Operacao", linhaDiario) }]);

    try {
      repo.aplicar(mutacoes);
      repo.aplicar([{ tabela: "Operacao", tipo: "atualizar", chave: { id_op: idOp },
        mudancas: { estado: "CONCLUIDA", resultado: JSON.stringify(paraGuardar), desfazer: "",
          concluido_em: amb.agora() } }]);
    } catch (e) {
      if (e instanceof R.ProcessoInterrompido) throw e;   // processo morto: nada a fazer aqui
      compensar(tx);
      try {
        repo.aplicar(inversas, { tolerante: true });
        repo.aplicar([{ tabela: "Operacao", tipo: "atualizar", chave: { id_op: idOp },
          mudancas: { estado: "REVERTIDA", desfazer: "", concluido_em: amb.agora() } }]);
      } catch (_) { /* a próxima execução reverte pelo diário */ }
      throw R.erro(500, { codigo: "falha_gravacao",
        mensagem: "Não foi possível gravar. Nada foi alterado; tente novamente." });
    }

  }

  /**
   * Executa `fn(tx)` como gravação. `fn` devolve { status, corpo } ou lança HttpErro.
   * opcoes: { idOp, usuarioEmail }.
   */
  R.executarGravacao = function executarGravacao(repo, amb, opcoes, fn) {
    return repo.trava(() => {
      recuperarInterrompidas(repo, amb);
      const idOp = (opcoes && opcoes.idOp) || amb.novoId();
      const usuarioEmail = opcoes && opcoes.usuarioEmail;
      const previa = repo.ler("Operacao").find((o) => o.id_op === idOp);
      if (previa && previa.estado === "CONCLUIDA") return JSON.parse(previa.resultado);

      const tx = R.criarTx(repo);
      if (repo.aoMeioDaGravacao) repo.aoMeioDaGravacao();
      let resultado;
      try {
        resultado = fn(tx);
      } catch (e) {
        // Recusa que registrou apenas auditoria (ex.: tentativa de alterar atendimento
        // encerrado): a trilha é gravada mesmo assim.
        const so = tx.mutacoes();
        if (e instanceof R.HttpErro && so.length && so.every((m) => m.tabela === "Auditoria")) {
          persistir(repo, amb, tx, amb.novoId(), usuarioEmail, null, { status: e.status });
        } else {
          compensar(tx);
        }
        throw e;
      }
      const resposta = { status: resultado.status, corpo: resultado.corpo };
      if (!tx.temMutacoes()) return resposta;
      persistir(repo, amb, tx, idOp, usuarioEmail, previa, resultado);
      return resposta;
    });
  };

  /** Leitura sem trava; qualquer gravação aqui é erro de programação. */
  R.executarLeitura = function executarLeitura(repo, fn) {
    const tx = R.criarTx(repo);
    const resultado = fn(tx);
    if (tx.temMutacoes()) throw new Error("tratador de leitura tentou gravar");
    return resultado;
  };
})(RoniVet);
