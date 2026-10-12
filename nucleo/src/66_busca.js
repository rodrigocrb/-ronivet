/* Busca de atendimentos e painel por espécie/sexo. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};
RoniVet.ROTAS = RoniVet.ROTAS || [];

(function (R) {
  "use strict";

  const T = R.tempo;
  const STATUS = ["AGENDADO", "CANCELADO", "ENCERRADO"];
  const TELEFONE_PLANO = (t) => String(t || "").replace(/[ ()+-]/g, "");

  function dataOpcional(valor, nome) {
    if (!valor) return null;
    if (!T.dataValida(valor)) throw R.erro(422, `${nome} inválida`);
    return valor;
  }

  /** Somente dados de identificação (sem campos clínicos), para qualquer perfil. */
  function buscar(ctx) {
    const { tx, req } = ctx;
    const q = (req.query.q || "").trim();
    const { tipo, status } = req.query;
    if (status && !STATUS.includes(status)) throw R.erro(422, "status inválido");
    let limite = 100;
    if (req.query.limite !== undefined) {
      limite = Number(req.query.limite);
      if (!Number.isInteger(limite) || limite < 1 || limite > 500) {
        throw R.validar.invalido("limite", "Input should be between 1 and 500");
      }
    }
    const de = dataOpcional(req.query.de, "data inicial");
    const ate = dataOpcional(req.query.ate, "data final");
    const termo = R.normalizar(q);
    const digitos = R.apenasDigitos(termo);

    const animais = new Map(tx.todos("Animal").map((a) => [a.id_animal, a]));
    const tutores = new Map(tx.todos("Tutor").map((t) => [t.id_tutor, t]));
    const tipos = new Map(tx.todos("TipoAtendimento").map((t) => [t.id_tipo, t]));

    const linhas = [];
    for (const at of tx.todos("Atendimento")) {
      const animal = animais.get(at.id_animal);
      const tutor = animal && tutores.get(animal.id_tutor);
      const tp = tipos.get(at.id_tipo);
      if (!animal || !tutor || !tp) continue;
      if (termo && !(R.normalizar(tutor.nome).includes(termo)
        || R.normalizar(animal.nome).includes(termo)
        || (digitos && TELEFONE_PLANO(tutor.telefone).includes(digitos)))) continue;
      if (tipo && at.id_tipo !== tipo) continue;
      if (status && at.status !== status) continue;
      const dia = at.inicio.slice(0, 10);
      if (de && dia < de) continue;
      if (ate && dia > ate) continue;
      linhas.push({ id: at.id_atendimento, inicio: at.inicio, status: at.status, tipo: tp.nome,
        animal: animal.nome, especie: animal.especie, tutor: tutor.nome, id_tutor: tutor.id_tutor });
    }
    linhas.sort((a, b) => (a.inicio < b.inicio ? 1 : (a.inicio > b.inicio ? -1 : 0)));
    return { status: 200, corpo: linhas.slice(0, limite) };
  }

  /** Atendimentos encerrados por espécie e sexo no período; dados agregados. */
  function dashboard(ctx) {
    const { tx, req } = ctx;
    if (!req.query.de) throw R.validar.invalido("de", "Field required");
    if (!req.query.ate) throw R.validar.invalido("ate", "Field required");
    const d0 = dataOpcional(req.query.de, "data inicial");
    const d1 = dataOpcional(req.query.ate, "data final");
    if (d1 < d0) throw R.erro(422, "intervalo inválido");
    const animais = new Map(tx.todos("Animal").map((a) => [a.id_animal, a]));
    const cruzado = new Map();
    const porEspecie = new Map();
    const porSexo = { MACHO: 0, FEMEA: 0, INDEFINIDO: 0 };
    for (const at of tx.todos("Atendimento")) {
      if (at.status !== "ENCERRADO") continue;
      const dia = at.inicio.slice(0, 10);
      if (dia < d0 || dia > d1) continue;
      if (req.query.tipo && at.id_tipo !== req.query.tipo) continue;
      const animal = animais.get(at.id_animal);
      if (!animal) continue;
      const chave = `${animal.especie}\u0000${animal.sexo}`;
      cruzado.set(chave, (cruzado.get(chave) || 0) + 1);
      porEspecie.set(animal.especie, (porEspecie.get(animal.especie) || 0) + 1);
      porSexo[animal.sexo] += 1;
    }
    const cruz = [...cruzado.entries()].map(([k, total]) => {
      const [especie, sexo] = k.split("\u0000");
      return { especie, sexo, total };
    }).sort((a, b) => (a.especie < b.especie ? -1 : (a.especie > b.especie ? 1
      : (a.sexo < b.sexo ? -1 : 1))));
    const espOrd = [...porEspecie.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return { status: 200, corpo: {
      de: d0, ate: d1,
      total: espOrd.reduce((s, [, n]) => s + n, 0),
      por_especie: espOrd.map(([especie, total]) => ({ especie, total })),
      por_sexo: Object.entries(porSexo).map(([sexo, total]) => ({ sexo, total })),
      por_especie_sexo: cruz,
    } };
  }

  R.ROTAS.push(
    { m: "GET", r: /^\/api\/busca$/, perfis: null, grava: false, h: buscar },
    { m: "GET", r: /^\/api\/dashboard$/, perfis: ["ADMIN", "VETERINARIO"], grava: false,
      h: dashboard },
  );
})(RoniVet);
