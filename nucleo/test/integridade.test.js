"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { criarAmbienteDeTeste } = require("./ambiente");

const PEDIDO = {
  inicio: "2026-10-12T08:00", id_tipo: "tipo-vacina",
  tutor: { nome: "Ana Souza", telefone: "11988887777", cpf: "529.982.247-25" },
  animal: { nome: "Thor", especie: "Cão" },
};

function cenario() {
  const e = criarAmbienteDeTeste();
  e.expediente();
  return e;
}

const contar = (e, tabela) => e.repo.ler(tabela).length;

// ---------- 4.2 horário único e CPF único sob concorrência ----------

test("dois agendamentos para o mesmo horário: um aceito, o outro recusado", () => {
  const e = cenario();
  let segundo = null;
  e.repo.aoMeioDaGravacao = () => {          // outro aparelho chega durante a gravação
    e.repo.aoMeioDaGravacao = null;
    segundo = e.chamar("sec@c.com", "POST", "/api/agendamentos",
      { ...PEDIDO, id: "b", tutor: { nome: "Beto", telefone: "2" }, animal: { nome: "Mel", especie: "Gato" } });
  };
  const primeiro = e.chamar("sec@c.com", "POST", "/api/agendamentos", { ...PEDIDO, id: "a" });
  assert.equal(primeiro.status, 201);
  assert.equal(segundo.status, 503, "a operação concorrente deve ser recusada pela trava");
  // reenviada depois, relê o estado dentro da trava e recebe o conflito de horário
  const reenvio = e.chamar("sec@c.com", "POST", "/api/agendamentos",
    { ...PEDIDO, id: "b", tutor: { nome: "Beto", telefone: "2" }, animal: { nome: "Mel", especie: "Gato" } });
  assert.equal(reenvio.status, 409);
  assert.equal(reenvio.corpo.detail.codigo, "conflito_horario");
  const ativos = e.repo.ler("Atendimento").filter((a) => a.status === "AGENDADO");
  assert.equal(ativos.length, 1);
});

test("dois cadastros com o mesmo CPF: um único tutor, o segundo reutiliza", () => {
  const e = cenario();
  let segundo = null;
  const outro = { ...PEDIDO, id: "b", inicio: "2026-10-12T08:30",
    tutor: { nome: "Outro Nome", telefone: "9", cpf: "52998224725" },
    animal: { nome: "Rex", especie: "Cão" } };
  e.repo.aoMeioDaGravacao = () => {
    e.repo.aoMeioDaGravacao = null;
    segundo = e.chamar("sec@c.com", "POST", "/api/agendamentos", outro);
  };
  assert.equal(e.chamar("sec@c.com", "POST", "/api/agendamentos", { ...PEDIDO, id: "a" }).status, 201);
  assert.equal(segundo.status, 503);
  const reenvio = e.chamar("sec@c.com", "POST", "/api/agendamentos", outro);
  assert.equal(reenvio.status, 201);
  assert.equal(reenvio.corpo.tutor_reutilizado, true);
  assert.equal(reenvio.corpo.tutor.nome, "Ana Souza", "não sobrescreve o cadastro existente");
  assert.equal(contar(e, "Tutor"), 1);
});

test("horário liberado por cancelamento aceita novo agendamento", () => {
  const e = cenario();
  assert.equal(e.chamar("sec@c.com", "POST", "/api/agendamentos", { ...PEDIDO, id: "a" }).status, 201);
  const outro = { ...PEDIDO, id: "b", tutor: { nome: "Beto", telefone: "2" },
    animal: { nome: "Mel", especie: "Gato" } };
  assert.equal(e.chamar("sec@c.com", "POST", "/api/agendamentos", outro).status, 409);
  assert.equal(e.chamar("sec@c.com", "POST", "/api/atendimentos/a/cancelar").status, 200);
  assert.equal(e.chamar("sec@c.com", "POST", "/api/agendamentos", outro).status, 201);
});

// ---------- 4.1 idempotência por id de operação ----------

test("reenvio com o mesmo id de operação devolve o resultado sem duplicar", () => {
  const e = cenario();
  const sem = { ...PEDIDO };   // sem ids: tutor, animal e atendimento são gerados pelo backend
  const a = e.chamar("sec@c.com", "POST", "/api/agendamentos", sem, { idOp: "op-123" });
  const b = e.chamar("sec@c.com", "POST", "/api/agendamentos", sem, { idOp: "op-123" });
  assert.equal(a.status, 201);
  assert.deepEqual(JSON.parse(JSON.stringify(b.corpo)), JSON.parse(JSON.stringify(a.corpo)));
  assert.equal(contar(e, "Tutor"), 1);
  assert.equal(contar(e, "Animal"), 1);
  assert.equal(contar(e, "Atendimento"), 1);
});

// ---------- 4.3 gravação composta tudo-ou-nada ----------

test("falha em qualquer parte do agendamento composto não deixa nada gravado", () => {
  const TABELAS = ["Tutor", "Animal", "Atendimento", "Auditoria"];
  for (let n = 2; n <= 8; n += 1) {
    const e = cenario();
    const antes = TABELAS.map((t) => contar(e, t));
    e.repo.falharNaMutacao = e.repo.aplicadasAteAgora() + n;
    const r = e.chamar("sec@c.com", "POST", "/api/agendamentos", { ...PEDIDO, id: "a" });
    assert.equal(r.status, 500, `falha na mutação ${n}`);
    assert.equal(r.corpo.detail.codigo, "falha_gravacao");
    TABELAS.forEach((tabela, i) => {
      assert.equal(contar(e, tabela), antes[i], `${tabela} mudou (falha na mutação ${n})`);
    });
    e.repo.falharNaMutacao = null;
    assert.equal(e.chamar("sec@c.com", "POST", "/api/agendamentos", { ...PEDIDO, id: "a" }).status, 201,
      "reenvio deve concluir");
  }
});

test("execução interrompida (processo morto) é revertida pela próxima operação", () => {
  const e = cenario();
  e.repo.interromperNaMutacao = e.repo.aplicadasAteAgora() + 5;   // morre no meio da gravação
  assert.throws(() => e.chamar("sec@c.com", "POST", "/api/agendamentos", { ...PEDIDO, id: "a" }),
    (erro) => erro instanceof e.R.ProcessoInterrompido);
  assert.ok(contar(e, "Tutor") >= 1, "estado parcial até a recuperação");
  e.repo.interromperNaMutacao = null;
  const lista = e.chamar("sec@c.com", "POST", "/api/tutores", { nome: "Zé", telefone: "1" });
  assert.equal(lista.status, 201);
  assert.equal(contar(e, "Tutor"), 1, "apenas o novo tutor; o parcial foi revertido");
  assert.equal(contar(e, "Atendimento"), 0);
  assert.equal(e.chamar("sec@c.com", "POST", "/api/agendamentos", { ...PEDIDO, id: "a" }).status, 201);
});

// ---------- 4.4 imutabilidade e versão ----------

test("aparelho offline que envia depois de outro encerrar tem a alteração recusada", () => {
  const e = cenario();
  e.chamar("sec@c.com", "POST", "/api/agendamentos", { ...PEDIDO, id: "at-1" });
  const dados = { produto: "V10", lote: "L1", data_aplicacao: "2026-10-12" };
  assert.equal(e.chamar("vet@c.com", "PUT", "/api/atendimentos/at-1/valores",
    { valores: dados, versao: 1 }).status, 200);
  // segundo aparelho ainda tem a versão 1 e envia depois do encerramento feito pelo primeiro
  assert.equal(e.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/encerrar").status, 200);
  const r = e.chamar("vet@c.com", "PUT", "/api/atendimentos/at-1/valores",
    { valores: { lote: "ADULTERADO" }, versao: 1 });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.detail.codigo, "atendimento_encerrado");
  const ficha = e.chamar("vet@c.com", "GET", "/api/atendimentos/at-1/ficha").corpo;
  assert.equal(ficha.valores.lote, "L1");
  const auditoria = e.chamar("admin@c.com", "GET", "/api/auditoria?acao=REJEITAR").corpo;
  assert.equal(auditoria.length, 1, "a recusa fica na trilha mesmo sendo erro");
});

// ---------- 4.5 selo de integridade ----------

function encerrado() {
  const e = cenario();
  e.chamar("sec@c.com", "POST", "/api/agendamentos", { ...PEDIDO, id: "at-1" });
  e.chamar("vet@c.com", "PUT", "/api/atendimentos/at-1/valores",
    { valores: { produto: "V10", lote: "L1", data_aplicacao: "2026-10-12" }, versao: 1 });
  assert.equal(e.chamar("vet@c.com", "POST", "/api/atendimentos/at-1/encerrar").status, 200);
  return e;
}

test("verificação de integridade: registros intactos conferem", () => {
  const e = encerrado();
  const r = e.chamar("admin@c.com", "GET", "/api/integridade");
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.total, 1);
  assert.equal(r.corpo.divergentes.length, 0);
});

test("dado de atendimento encerrado alterado direto na planilha é detectado", () => {
  const e = encerrado();
  const celula = e.repo.ler("CampoValor").find((v) => v.valor === "L1");
  e.repo.aplicar([{ tabela: "CampoValor", tipo: "atualizar",
    chave: { id_atendimento: celula.id_atendimento, id_campo: celula.id_campo },
    mudancas: { valor: "L2-ADULTERADO" } }]);
  const r = e.chamar("admin@c.com", "GET", "/api/integridade").corpo;
  assert.equal(r.ok, false);
  assert.equal(r.divergentes[0].id, "at-1");
  assert.ok(r.divergentes[0].motivos.includes("dados_alterados"));
});

test("documento substituído fora do aplicativo é detectado e a verificação falha", () => {
  const e = encerrado();
  const arquivo = e.repo.ler("Atendimento")[0].arquivo_pdf;
  e.repo.gravarArquivo(arquivo, "outro conteúdo");
  const v = e.chamar("vet@c.com", "GET", "/api/atendimentos/at-1/verificacao").corpo;
  assert.equal(v.ok, false);
  assert.notEqual(v.hash_atual, v.hash_registrado);
  const r = e.chamar("admin@c.com", "GET", "/api/integridade").corpo;
  assert.ok(r.divergentes[0].motivos.includes("documento_alterado"));
});

test("documento removido é apontado como ausente", () => {
  const e = encerrado();
  e.repo.excluirArquivo(e.repo.ler("Atendimento")[0].arquivo_pdf);
  const r = e.chamar("admin@c.com", "GET", "/api/integridade").corpo;
  assert.ok(r.divergentes[0].motivos.includes("documento_ausente"));
});

test("somente o administrador executa a verificação de integridade", () => {
  const e = encerrado();
  assert.equal(e.chamar("vet@c.com", "GET", "/api/integridade").status, 403);
  assert.equal(e.chamar("sec@c.com", "GET", "/api/integridade").status, 403);
});
