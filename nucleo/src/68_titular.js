/* Direitos do titular (LGPD): acesso e eliminação, preservando a guarda obrigatória. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};
RoniVet.ROTAS = RoniVet.ROTAS || [];

(function (R) {
  "use strict";

  const V = R.validar;
  const ELIMINADO = "ELIMINADO";

  const tutorDe = (tx, id) => {
    const t = tx.obter("Tutor", id);
    if (!t) throw R.erro(404, "tutor não encontrado");
    return t;
  };

  /** Reúne os dados pessoais do tutor e os registros dos seus animais (pedido de acesso). */
  function dadosDoTitular(ctx) {
    const { tx } = ctx;
    const id = ctx.req.params[0];
    const tutor = tutorDe(tx, id);
    const animais = tx.onde("Animal", (a) => a.id_tutor === id);
    const saida = { tutor, animais: [] };
    for (const a of animais) {
      const atendimentos = tx.onde("Atendimento", (x) => x.id_animal === a.id_animal)
        .sort((x, y) => (x.inicio < y.inicio ? -1 : (x.inicio > y.inicio ? 1 : 0)))
        .map((x) => ({ id_atendimento: x.id_atendimento, id_tipo: x.id_tipo, inicio: x.inicio,
          status: x.status, encerrado_em: x.encerrado_em, veterinario_email: x.veterinario_email,
          hash_sha256: x.hash_sha256 }));
      const vacinas = tx.onde("Vacina", (x) => x.id_animal === a.id_animal)
        .sort((x, y) => (x.data_aplicacao < y.data_aplicacao ? -1 : 1))
        .map((x) => ({ produto: x.produto, lote: x.lote, data_aplicacao: x.data_aplicacao,
          proxima_dose: x.proxima_dose }));
      saida.animais.push({ animal: a, atendimentos, vacinas });
    }
    R.auditar(ctx, "CONSULTAR", "Titular", id, "pedido_de_acesso", null, null);
    return { status: 200, corpo: saida };
  }

  /** Se houver atendimento encerrado (guarda obrigatória), elimina só os dados de contato. */
  function eliminar(ctx) {
    const { tx, usuario, amb } = ctx;
    const id = ctx.req.params[0];
    const c = V.objeto(ctx.req.corpo);
    const motivo = V.preenchido(c, "motivo");
    const tutor = tutorDe(tx, id);
    const idsAnimais = tx.onde("Animal", (a) => a.id_tutor === id).map((a) => a.id_animal);
    const atendimentos = tx.onde("Atendimento", (a) => idsAnimais.includes(a.id_animal));
    const encerrados = atendimentos.filter((a) => a.status === "ENCERRADO").length;
    let resultado;
    if (encerrados) {
      const agora = amb.agora();
      tx.atualizar("Tutor", id, { telefone: ELIMINADO, cpf: null, email: null, endereco: null,
        aceita_contato: "NAO", consentimento_em: agora, consentimento_por: usuario.email,
        atualizado_em: agora, atualizado_por: usuario.email });
      resultado = "contato_eliminado_guarda_mantida";
    } else {
      const idsAt = atendimentos.map((a) => a.id_atendimento);
      for (const x of tx.onde("ContatoCampanha", (k) => idsAnimais.includes(k.id_animal))) {
        tx.excluir("ContatoCampanha", x.id_contato);
      }
      for (const x of tx.onde("Vacina", (k) => idsAnimais.includes(k.id_animal))) {
        tx.excluir("Vacina", x.id_vacina);
      }
      for (const x of tx.onde("CampoValor", (k) => idsAt.includes(k.id_atendimento))) {
        tx.excluir("CampoValor", { id_atendimento: x.id_atendimento, id_campo: x.id_campo });
      }
      for (const x of tx.onde("Aditamento", (k) => idsAt.includes(k.id_atendimento))) {
        tx.excluir("Aditamento", x.id_aditamento);
      }
      for (const x of atendimentos) tx.excluir("Atendimento", x.id_atendimento);
      for (const idAnimal of idsAnimais) tx.excluir("Animal", idAnimal);
      tx.excluir("Tutor", id);
      resultado = "eliminado_por_completo";
    }
    R.auditar(ctx, "ALTERAR", "Titular", id, "eliminacao", null, `${resultado}: ${motivo}`);
    return { status: 200, corpo: { resultado, atendimentos_encerrados_mantidos: encerrados,
      nome_mantido: !!encerrados && tutor.nome !== null } };
  }

  R.ROTAS.push(
    { m: "GET", r: /^\/api\/titular\/([^/]+)\/dados$/, perfis: ["ADMIN"], grava: true,
      h: dadosDoTitular },
    { m: "POST", r: /^\/api\/titular\/([^/]+)\/eliminar$/, perfis: ["ADMIN"], grava: true,
      h: eliminar },
  );
})(RoniVet);
