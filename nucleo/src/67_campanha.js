/* Campanha de reforço vacinal anual. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};
RoniVet.ROTAS = RoniVet.ROTAS || [];

(function (R) {
  "use strict";

  const V = R.validar;
  const T = R.tempo;
  const PERFIS = ["SECRETARIA", "ADMIN"];
  const ELIMINADO = "ELIMINADO";

  /** Próxima dose informada; senão, 12 meses após a aplicação. */
  const calcularVencimento = (aplicacao, proxima) => proxima || T.somarMeses(aplicacao, 12);

  function diasDe(req) {
    if (req.query.dias === undefined) return 30;
    const d = Number(req.query.dias);
    if (!Number.isInteger(d) || d < 0 || d > 365) {
      throw V.invalido("dias", "Input should be between 0 and 365");
    }
    return d;
  }

  function hojeDe(ctx) {
    const h = ctx.req.query.hoje;
    if (!h) return ctx.amb.agora().slice(0, 10);
    if (!T.dataValida(h)) throw R.erro(422, "data inválida");
    return h;
  }

  function itensDaCampanha(tx, hoje, dias) {
    const limite = T.somarDias(hoje, dias);
    const animais = new Map(tx.todos("Animal").map((a) => [a.id_animal, a]));
    const tutores = new Map(tx.todos("Tutor").map((t) => [t.id_tutor, t]));
    // Aplicação mais recente de cada vacina (produto) por animal.
    const maisRecente = new Map();
    for (const v of tx.todos("Vacina")) {
      const chave = `${v.id_animal}\u0000${(v.produto || "").toLowerCase()}`;
      const atual = maisRecente.get(chave);
      if (!atual || v.data_aplicacao > atual.data_aplicacao
        || (v.data_aplicacao === atual.data_aplicacao && v.criado_em >= atual.criado_em)) {
        maisRecente.set(chave, v);
      }
    }
    const contatos = new Map();
    for (const c of tx.todos("ContatoCampanha")) {
      if (!contatos.has(c.id_animal) || c.data_contato > contatos.get(c.id_animal)) {
        contatos.set(c.id_animal, c.data_contato);
      }
    }
    const saida = [];
    for (const v of maisRecente.values()) {
      const animal = animais.get(v.id_animal);
      const tutor = animal && tutores.get(animal.id_tutor);
      if (!animal || animal.ativo !== "SIM" || !tutor || tutor.ativo !== "SIM") continue;
      const vencimento = calcularVencimento(v.data_aplicacao, v.proxima_dose);
      if (vencimento > limite) continue;
      const autorizado = tutor.aceita_contato === "SIM" && tutor.telefone !== ELIMINADO;
      saida.push({
        id_vacina: v.id_vacina, id_animal: v.id_animal, animal: animal.nome,
        especie: animal.especie, vacina: v.produto, ultima_aplicacao: v.data_aplicacao,
        vencimento, situacao: vencimento < hoje ? "ATRASADO" : "A_VENCER", tutor: tutor.nome,
        telefone: autorizado ? tutor.telefone : null, contatar: autorizado,
        sem_autorizacao_de_contato: !autorizado,
        ultimo_contato: (contatos.get(v.id_animal) || "").slice(0, 10) || null,
      });
    }
    saida.sort((a, b) => (a.vencimento < b.vencimento ? -1 : (a.vencimento > b.vencimento ? 1
      : (a.animal < b.animal ? -1 : (a.animal > b.animal ? 1 : 0)))));
    return saida;
  }

  function listar(ctx) {
    return { status: 200, corpo: itensDaCampanha(ctx.tx, hojeDe(ctx), diasDe(ctx.req)) };
  }

  function registrarContato(ctx) {
    const { tx, usuario, amb } = ctx;
    const c = V.objeto(ctx.req.corpo);
    const idAnimal = V.textoObrigatorio(c, "id_animal");
    const idVacina = V.textoOpcional(c, "id_vacina") || null;
    const resultado = V.textoOpcional(c, "resultado");
    const id = V.textoOpcional(c, "id") || amb.novoId();
    const existente = tx.obter("ContatoCampanha", id);
    if (existente) return { status: 201, corpo: existente };
    if (!tx.obter("Animal", idAnimal)) throw R.erro(404, "animal não encontrado");
    if (idVacina && !tx.obter("Vacina", idVacina)) throw R.erro(404, "vacina não encontrada");
    tx.inserir("ContatoCampanha", { id_contato: id, id_animal: idAnimal, id_vacina: idVacina,
      data_contato: amb.agora(), resultado: resultado ? resultado.trim() : resultado ?? null,
      registrado_por: usuario.email });
    R.auditar(ctx, "CRIAR", "ContatoCampanha", id);
    return { status: 201, corpo: tx.obter("ContatoCampanha", id) };
  }

  /** CSV (separador ';', UTF-8 com BOM, abre direto no Excel) com as colunas da lista. */
  function exportar(ctx) {
    const { tx } = ctx;
    const hoje = hojeDe(ctx);
    const itens = itensDaCampanha(tx, hoje, diasDe(ctx.req));
    const celula = (v) => {
      const t = String(v === null || v === undefined ? "" : v);
      return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const linhas = [["Animal", "Espécie", "Vacina", "Última aplicação", "Vencimento", "Situação",
      "Tutor", "Telefone", "Contato autorizado", "Último contato"]];
    for (const i of itens) {
      linhas.push([i.animal, i.especie, i.vacina || "", i.ultima_aplicacao, i.vencimento,
        i.situacao, i.tutor, i.telefone || "", i.contatar ? "Sim" : "Não", i.ultimo_contato || ""]);
    }
    R.auditar(ctx, "CONSULTAR", "Campanha", null, "exportacao", null, `${itens.length} linhas`);
    return { status: 200, corpo: { tipo_conteudo: "text/csv; charset=utf-8",
      nome_arquivo: `campanha-vacinal-${hoje}.csv`,
      texto: `﻿${linhas.map((l) => l.map(celula).join(";")).join("\r\n")}\r\n` } };
  }

  R.itensDaCampanha = itensDaCampanha;
  R.ROTAS.push(
    { m: "GET", r: /^\/api\/campanha$/, perfis: PERFIS, grava: false, h: listar },
    { m: "POST", r: /^\/api\/campanha\/contatos$/, perfis: PERFIS, grava: true,
      h: registrarContato },
    { m: "GET", r: /^\/api\/campanha\/exportar$/, perfis: PERFIS, grava: true, h: exportar },
  );
})(RoniVet);
