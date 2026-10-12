/* Horários de atendimento, disponibilidade e agendamento. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};
RoniVet.ROTAS = RoniVet.ROTAS || [];

(function (R) {
  "use strict";

  const V = R.validar;
  const T = R.tempo;
  const { ESCREVEM } = R.GRUPOS;
  const OCUPAM_HORARIO = ["AGENDADO", "ENCERRADO"];

  // ---------- configuração de horários ----------

  R.configCompleta = (tx) => {
    const existentes = new Map(tx.todos("Config").map((c) => [Number(c.dia_semana), c]));
    const saida = [];
    for (let dia = 0; dia < 7; dia += 1) {
      const r = existentes.get(dia);
      saida.push(r
        ? { dia_semana: dia, atende: r.atende, inicio: r.inicio, fim: r.fim,
          duracao_min: r.duracao_min }
        : { dia_semana: dia, atende: "NAO", inicio: null, fim: null, duracao_min: null });
    }
    return saida;
  };

  function obterConfig(ctx) {
    return { status: 200, corpo: R.configCompleta(ctx.tx) };
  }

  function salvarConfig(ctx) {
    const { tx } = ctx;
    const c = V.objeto(ctx.req.corpo);
    if (!Array.isArray(c.dias)) throw V.invalido("dias", "Field required");
    const dias = c.dias.map((d, i) => {
      const o = V.objeto(d);
      const dia = V.inteiroObrigatorio(o, "dia_semana");
      if (dia < 0 || dia > 6) throw V.invalido(`dias.${i}.dia_semana`, "dia_semana entre 0 e 6");
      const atende = V.textoObrigatorio(o, "atende");
      V.opcao(atende, `dias.${i}.atende`, ["SIM", "NAO"]);
      return { dia_semana: dia, atende, inicio: V.textoOpcional(o, "inicio") ?? null,
        fim: V.textoOpcional(o, "fim") ?? null, duracao_min: V.inteiroOpcional(o, "duracao_min") };
    });
    for (const d of dias) {
      if (d.atende !== "SIM") continue;
      if (!(d.inicio && d.fim && T.FORMATO_HORA.test(d.inicio) && T.FORMATO_HORA.test(d.fim))) {
        throw R.erro(422, "informe início e fim (HH:MM) para dias com atendimento");
      }
      if (T.horaEmMinutos(d.inicio) >= T.horaEmMinutos(d.fim)) {
        throw R.erro(422, "início deve ser anterior ao fim");
      }
      if (!d.duracao_min || d.duracao_min <= 0) throw R.erro(422, "informe a duração do horário");
    }
    const antes = new Map(R.configCompleta(tx).map((x) => [x.dia_semana, x]));
    for (const d of dias) {
      const novo = d.atende === "NAO"
        ? { dia_semana: d.dia_semana, atende: "NAO", inicio: null, fim: null, duracao_min: null }
        : d;
      if (tx.obter("Config", d.dia_semana)) {
        tx.atualizar("Config", d.dia_semana, { atende: novo.atende, inicio: novo.inicio,
          fim: novo.fim, duracao_min: novo.duracao_min });
      } else {
        tx.inserir("Config", novo);
      }
      if (JSON.stringify(antes.get(d.dia_semana)) !== JSON.stringify(novo)) {
        R.auditar(ctx, "ALTERAR", "Config", String(d.dia_semana), "horario",
          JSON.stringify(antes.get(d.dia_semana)), JSON.stringify(novo));
      }
    }
    return { status: 200, corpo: R.configCompleta(tx) };
  }

  // ---------- disponibilidade ----------

  const configDoDia = (tx, dia) => {
    const c = tx.obter("Config", T.diaSemana(dia));
    return c && c.atende === "SIM" ? c : null;
  };

  /** Intervalos [inicio, fim) em minutos ocupados no dia (agendados e encerrados). */
  const ocupadosNoDia = (tx, dia, ignorar) => tx.todos("Atendimento")
    .filter((a) => OCUPAM_HORARIO.includes(a.status) && a.inicio.slice(0, 10) === dia
      && a.id_atendimento !== ignorar)
    .map((a) => { const ini = T.emMinutos(a.inicio); return [ini, ini + a.duracao_min]; });

  const sobrepoe = (ini, fim, ocupados) => ocupados.some(([oi, of]) => ini < of && oi < fim);

  function horariosDoDia(ctx) {
    const { tx, req } = ctx;
    const data = req.query.data;
    if (!data) throw V.invalido("data", "Field required");
    if (!T.dataValida(data)) throw R.erro(422, "data inválida");
    let duracaoParam = null;
    if (req.query.duracao_min !== undefined) {
      duracaoParam = Number(req.query.duracao_min);
      if (!Number.isInteger(duracaoParam) || duracaoParam <= 0) {
        throw V.invalido("duracao_min", "Input should be greater than 0");
      }
    }
    const cfg = configDoDia(tx, data);
    if (!cfg) return { status: 200, corpo: [] };
    const passo = cfg.duracao_min;
    const duracao = duracaoParam || passo;
    const ocupados = ocupadosNoDia(tx, data);
    const ini = T.horaEmMinutos(cfg.inicio);
    const fim = T.horaEmMinutos(cfg.fim);
    const base = T.emMinutos(`${data}T00:00`);
    const horarios = [];
    for (let minuto = ini; minuto <= fim - duracao; minuto += passo) {
      const inicioMin = base + minuto;
      horarios.push({
        inicio: T.somarMinutos(`${data}T00:00`, minuto),
        livre: !sobrepoe(inicioMin, inicioMin + duracao, ocupados),
      });
    }
    return { status: 200, corpo: horarios };
  }

  /** Lança 422 (fora do expediente) ou 409 (conflito), conforme a spec. */
  R.validarHorario = function validarHorario(tx, inicio, duracao, ignorar) {
    const dia = inicio.slice(0, 10);
    const cfg = configDoDia(tx, dia);
    const minutos = T.horaEmMinutos(inicio.slice(11));
    if (!cfg || minutos < T.horaEmMinutos(cfg.inicio)
      || minutos + duracao > T.horaEmMinutos(cfg.fim)) {
      throw R.erro(422, { codigo: "fora_do_expediente", mensagem: "Horário fora do expediente." });
    }
    const ini = T.emMinutos(inicio);
    if (sobrepoe(ini, ini + duracao, ocupadosNoDia(tx, dia, ignorar))) {
      throw R.erro(409, { codigo: "conflito_horario", mensagem: "Horário já ocupado." });
    }
  };

  // ---------- atendimentos ----------

  R.atendimentoDict = (tx, a) => {
    const animal = tx.obter("Animal", a.id_animal);
    const tutor = animal ? tx.obter("Tutor", animal.id_tutor) : null;
    const tipo = tx.obter("TipoAtendimento", a.id_tipo);
    return {
      id: a.id_atendimento, id_animal: a.id_animal, id_tipo: a.id_tipo, inicio: a.inicio,
      duracao_min: a.duracao_min, status: a.status,
      animal: animal ? animal.nome : null, especie: animal ? animal.especie : null,
      tutor: tutor ? tutor.nome : null, tipo: tipo ? tipo.nome : null, versao: a.versao,
    };
  };

  const obterAt = (tx, id) => {
    const a = tx.obter("Atendimento", id);
    if (!a) throw R.erro(404, "atendimento não encontrado");
    return a;
  };

  R.obterAtendimento = obterAt;

  function exigirNaoEncerrado(ctx, a) {
    if (a.status === "ENCERRADO") {
      R.auditar(ctx, "REJEITAR", "Atendimento", a.id_atendimento, "status", "ENCERRADO",
        "alteração recusada");
      throw R.erro(409, { codigo: "atendimento_encerrado",
        mensagem: "Atendimento encerrado não pode ser alterado." });
    }
    if (a.status === "CANCELADO") {
      throw R.erro(409, { codigo: "atendimento_cancelado", mensagem: "Atendimento cancelado." });
    }
  }

  function duracaoPositiva(c) {
    const d = V.inteiroOpcional(c, "duracao_min");
    if (d !== null && d <= 0) throw V.invalido("duracao_min", "duração deve ser positiva");
    return d;
  }

  function agendar(ctx) {
    const { tx, usuario, amb } = ctx;
    const c = V.objeto(ctx.req.corpo);
    const idAnimal = V.textoObrigatorio(c, "id_animal");
    const idTipo = V.textoObrigatorio(c, "id_tipo");
    const inicioTxt = V.textoObrigatorio(c, "inicio");
    const duracaoIn = duracaoPositiva(c);
    const id = V.textoOpcional(c, "id") || amb.novoId();

    const existente = tx.obter("Atendimento", id);
    if (existente) return { status: 201, corpo: R.atendimentoDict(tx, existente) };  // reenvio
    const animal = tx.obter("Animal", idAnimal);
    if (!animal || animal.ativo !== "SIM") throw R.erro(404, "animal não encontrado");
    const tipo = tx.obter("TipoAtendimento", idTipo);
    if (!tipo || tipo.ativo !== "SIM") throw R.erro(404, "tipo de atendimento não encontrado");
    const inicio = T.parseInicio(inicioTxt);
    const duracao = duracaoIn || tipo.duracao_min;
    R.validarHorario(tx, inicio, duracao);
    const agora = amb.agora();
    tx.inserir("Atendimento", { id_atendimento: id, id_animal: idAnimal, id_tipo: idTipo, inicio,
      duracao_min: duracao, status: "AGENDADO", versao: 1, criado_em: agora,
      criado_por: usuario.email, atualizado_em: agora, atualizado_por: usuario.email });
    R.auditar(ctx, "CRIAR", "Atendimento", id);
    return { status: 201, corpo: R.atendimentoDict(tx, obterAt(tx, id)) };
  }

  function remarcar(ctx) {
    const { tx, usuario, amb } = ctx;
    const id = ctx.req.params[0];
    const c = V.objeto(ctx.req.corpo);
    const inicioTxt = V.textoObrigatorio(c, "inicio");
    const duracaoIn = duracaoPositiva(c);
    const atual = obterAt(tx, id);
    exigirNaoEncerrado(ctx, atual);
    const inicio = T.parseInicio(inicioTxt);
    const duracao = duracaoIn || atual.duracao_min;
    R.validarHorario(tx, inicio, duracao, id);
    tx.atualizar("Atendimento", id, { inicio, duracao_min: duracao, versao: atual.versao + 1,
      atualizado_em: amb.agora(), atualizado_por: usuario.email });
    R.auditar(ctx, "ALTERAR", "Atendimento", id, "inicio", atual.inicio, inicio);
    return { status: 200, corpo: R.atendimentoDict(tx, obterAt(tx, id)) };
  }

  function cancelar(ctx) {
    const { tx, usuario, amb } = ctx;
    const id = ctx.req.params[0];
    const atual = obterAt(tx, id);
    if (atual.status === "CANCELADO") return { status: 200, corpo: R.atendimentoDict(tx, atual) };
    exigirNaoEncerrado(ctx, atual);
    tx.atualizar("Atendimento", id, { status: "CANCELADO", versao: atual.versao + 1,
      atualizado_em: amb.agora(), atualizado_por: usuario.email });
    R.auditar(ctx, "ALTERAR", "Atendimento", id, "status", atual.status, "CANCELADO");
    return { status: 200, corpo: R.atendimentoDict(tx, obterAt(tx, id)) };
  }

  function obterAtendimentoRota(ctx) {
    return { status: 200, corpo: R.atendimentoDict(ctx.tx, obterAt(ctx.tx, ctx.req.params[0])) };
  }

  function agenda(ctx) {
    const { tx, req } = ctx;
    const de = req.query.de;
    if (!de) throw V.invalido("de", "Field required");
    const ate = req.query.ate || de;
    if (!T.dataValida(de) || !T.dataValida(ate)) throw R.erro(422, "data inválida");
    if (ate < de) throw R.erro(422, "intervalo inválido");
    const linhas = tx.todos("Atendimento")
      .filter((a) => a.inicio.slice(0, 10) >= de && a.inicio.slice(0, 10) <= ate)
      .sort((a, b) => (a.inicio < b.inicio ? -1 : (a.inicio > b.inicio ? 1 : 0)));
    return { status: 200, corpo: linhas.map((a) => R.atendimentoDict(tx, a)) };
  }

  R.ROTAS.push(
    { m: "GET", r: /^\/api\/config-horarios$/, perfis: null, grava: false, h: obterConfig },
    { m: "PUT", r: /^\/api\/config-horarios$/, perfis: ["ADMIN"], grava: true, h: salvarConfig },
    { m: "GET", r: /^\/api\/horarios$/, perfis: null, grava: false, h: horariosDoDia },
    { m: "POST", r: /^\/api\/atendimentos$/, perfis: ESCREVEM, grava: true, h: agendar },
    { m: "PATCH", r: /^\/api\/atendimentos\/([^/]+)$/, perfis: ESCREVEM, grava: true, h: remarcar },
    { m: "POST", r: /^\/api\/atendimentos\/([^/]+)\/cancelar$/, perfis: ESCREVEM, grava: true,
      h: cancelar },
    { m: "GET", r: /^\/api\/atendimentos\/([^/]+)$/, perfis: null, grava: false,
      h: obterAtendimentoRota },
    { m: "GET", r: /^\/api\/agenda$/, perfis: null, grava: false, h: agenda },
  );
})(RoniVet);
