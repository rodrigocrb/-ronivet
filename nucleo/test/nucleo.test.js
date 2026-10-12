"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { carregar } = require("./carregar");

// Objetos criados no contexto vm têm outro protótipo: compara pelo conteúdo JSON.
const plano = (x) => JSON.parse(JSON.stringify(x));

function ambiente(R) {
  let n = 0;
  return { agora: () => "2026-10-11T10:00:00-03:00", novoId: () => `id-${++n}` };
}

function tutorBase(extra = {}) {
  return { id_tutor: "t1", nome: "Maria", telefone: "11", criado_em: "x", criado_por: "x",
    atualizado_em: "x", atualizado_por: "x", ...extra };
}

test("cada módulo é importado e expõe sua API (fumaça)", () => {
  const R = carregar();
  for (const nome of ["HttpErro", "cpf", "tempo", "TABELAS", "criarRepositorioMemoria", "criarTx",
    "executarGravacao", "executarLeitura", "inverterMutacoes"]) {
    assert.ok(R[nome], `RoniVet.${nome} ausente`);
  }
});

test("CPF: normaliza, valida e mascara", () => {
  const { cpf } = carregar();
  assert.equal(cpf.normalizar("529.982.247-25"), "52998224725");
  assert.equal(cpf.valido("529.982.247-25"), true);
  assert.equal(cpf.valido("52998224726"), false);
  assert.equal(cpf.valido("11111111111"), false);
  assert.equal(cpf.valido("123"), false);
  assert.equal(cpf.mascarar("52998224725"), "***.982.247-**");
  assert.equal(cpf.mascarar("1"), "***");
});

test("tempo: dia da semana, minutos e meses", () => {
  const { tempo } = carregar();
  assert.equal(tempo.diaSemana("2026-10-11"), 0);   // domingo
  assert.equal(tempo.diaSemana("2026-10-12"), 1);   // segunda
  assert.equal(tempo.somarMinutos("2026-10-12T11:45", 30), "2026-10-12T12:15");
  assert.equal(tempo.somarMeses("2026-01-31", 1), "2026-02-28");
  assert.equal(tempo.somarMeses("2026-11-30", 3), "2027-02-28");
  assert.equal(tempo.dataValida("2026-02-30"), false);
  assert.throws(() => tempo.parseInicio("2026-10-12 09:00"), { status: 422 });
});

test("repositório: inserir, ler, atualizar em lote, excluir e trava exclusiva", () => {
  const R = carregar();
  const repo = R.criarRepositorioMemoria();
  repo.aplicar([{ tabela: "Tutor", tipo: "inserir", linha: R.completarLinha("Tutor", tutorBase()) }]);
  assert.equal(repo.ler("Tutor").length, 1);
  repo.aplicar([{ tabela: "Tutor", tipo: "atualizar", chave: { id_tutor: "t1" },
    mudancas: { nome: "Ana" } }]);
  assert.equal(repo.ler("Tutor")[0].nome, "Ana");
  assert.throws(() => repo.aplicar([{ tabela: "Tutor", tipo: "inserir",
    linha: R.completarLinha("Tutor", tutorBase()) }]), /duplicada/);
  repo.aplicar([{ tabela: "Tutor", tipo: "excluir", chave: { id_tutor: "t1" } }]);
  assert.equal(repo.ler("Tutor").length, 0);
  assert.throws(() => repo.trava(() => repo.trava(() => 1)), { status: 503 });
  assert.equal(repo.trava(() => "ok"), "ok");   // libera a trava ao sair
});

test("unidade de trabalho: sobrepõe leituras e guarda o que desfaz", () => {
  const R = carregar();
  const repo = R.criarRepositorioMemoria();
  const tx = R.criarTx(repo);
  tx.inserir("Tutor", tutorBase());
  assert.equal(tx.obter("Tutor", "t1").nome, "Maria");
  tx.atualizar("Tutor", "t1", { nome: "Ana", telefone: "11" });   // telefone igual: ignorado
  const m = tx.mutacoes();
  assert.equal(m.length, 2);
  assert.deepEqual(plano(m[1].antes), { nome: "Maria" });
  assert.equal(repo.ler("Tutor").length, 0, "nada gravado antes do commit");
  const inv = R.inverterMutacoes(m);
  assert.deepEqual(plano(inv.map((x) => x.tipo)), ["atualizar", "excluir"]);
});

test("gravação aplica e guarda o resultado da operação", () => {
  const R = carregar();
  const repo = R.criarRepositorioMemoria();
  const amb = ambiente(R);
  const r = R.executarGravacao(repo, amb, { idOp: "op-1" }, (tx) => {
    tx.inserir("Tutor", tutorBase());
    return { status: 201, corpo: { id: "t1" } };
  });
  assert.deepEqual(plano(r), { status: 201, corpo: { id: "t1" } });
  assert.equal(repo.ler("Tutor").length, 1);
  assert.equal(repo.ler("Operacao")[0].estado, "CONCLUIDA");
});

test("idempotência: o reenvio devolve o resultado original sem repetir efeitos", () => {
  const R = carregar();
  const repo = R.criarRepositorioMemoria();
  const amb = ambiente(R);
  let execucoes = 0;
  const gravar = () => R.executarGravacao(repo, amb, { idOp: "op-9" }, (tx) => {
    execucoes += 1;
    tx.inserir("Tutor", tutorBase());
    return { status: 201, corpo: { id: "t1" } };
  });
  const primeira = gravar();
  const segunda = gravar();
  assert.deepEqual(plano(segunda), plano(primeira));
  assert.equal(execucoes, 1);
  assert.equal(repo.ler("Tutor").length, 1);
});

test("erro de validação não grava nada nem deixa diário", () => {
  const R = carregar();
  const repo = R.criarRepositorioMemoria();
  assert.throws(() => R.executarGravacao(repo, ambiente(R), { idOp: "op-2" }, (tx) => {
    tx.inserir("Tutor", tutorBase());
    throw R.erro(422, "inválido");
  }), { status: 422 });
  assert.equal(repo.ler("Tutor").length, 0);
  assert.equal(repo.ler("Operacao").length, 0);
});

test("falha no meio da aplicação desfaz tudo e permite reenviar", () => {
  const R = carregar();
  const repo = R.criarRepositorioMemoria();
  const amb = ambiente(R);
  const fn = (tx) => {
    tx.inserir("Tutor", tutorBase());
    tx.inserir("Animal", { id_animal: "a1", id_tutor: "t1", nome: "Rex", especie: "Cão",
      criado_em: "x", criado_por: "x", atualizado_em: "x", atualizado_por: "x" });
    return { status: 201, corpo: { ok: true } };
  };
  repo.falharNaMutacao = 3;   // 1 = diário, 2 = tutor, 3 = animal
  assert.throws(() => R.executarGravacao(repo, amb, { idOp: "op-3" }, fn), { status: 500 });
  assert.equal(repo.ler("Tutor").length, 0, "o tutor gravado foi revertido");
  assert.equal(repo.ler("Animal").length, 0);
  assert.equal(repo.ler("Operacao")[0].estado, "REVERTIDA");
  repo.falharNaMutacao = null;
  assert.equal(R.executarGravacao(repo, amb, { idOp: "op-3" }, fn).status, 201);
  assert.equal(repo.ler("Tutor").length, 1);
});

test("execução interrompida é revertida pelo próximo detentor da trava", () => {
  const R = carregar();
  const repo = R.criarRepositorioMemoria();
  const amb = ambiente(R);
  repo.aplicar([{ tabela: "Tutor", tipo: "inserir",
    linha: R.completarLinha("Tutor", tutorBase({ id_tutor: "t0", nome: "Antes" })) }]);
  repo.interromperNaMutacao = 4;   // diário(2) + tutor + atualização do t0 -> morre na 2ª mutação
  assert.throws(() => R.executarGravacao(repo, amb, { idOp: "op-4" }, (tx) => {
    tx.inserir("Tutor", tutorBase());
    tx.atualizar("Tutor", "t0", { nome: "Depois" });
    return { status: 200, corpo: {} };
  }), R.ProcessoInterrompido);
  assert.equal(repo.ler("Operacao")[0].estado, "EM_ANDAMENTO");
  assert.equal(repo.ler("Tutor").length, 2, "estado parcial visível até a recuperação");
  // outra operação qualquer entra e antes de tudo reverte a interrompida
  R.executarGravacao(repo, amb, { idOp: "op-5" }, () => ({ status: 200, corpo: {} }));
  const tutores = repo.ler("Tutor");
  assert.equal(tutores.length, 1);
  assert.equal(tutores[0].nome, "Antes");
  assert.equal(repo.ler("Operacao").find((o) => o.id_op === "op-4").estado, "REVERTIDA");
});

test("compensações (arquivos) rodam quando a operação falha", () => {
  const R = carregar();
  const repo = R.criarRepositorioMemoria();
  repo.gravarArquivo("x.pdf", "conteudo");
  assert.throws(() => R.executarGravacao(repo, ambiente(R), {}, (tx) => {
    tx.registrarCompensacao(() => repo.excluirArquivo("x.pdf"));
    throw R.erro(500, "falhou");
  }), { status: 500 });
  assert.equal(repo.existeArquivo("x.pdf"), false);
});

test("trava: operação que chega durante outra recebe 'sistema ocupado'", () => {
  const R = carregar();
  const repo = R.criarRepositorioMemoria();
  const amb = ambiente(R);
  let erroDoSegundo = null;
  repo.aoMeioDaGravacao = () => {
    repo.aoMeioDaGravacao = null;
    try {
      R.executarGravacao(repo, amb, { idOp: "outra" }, () => ({ status: 200, corpo: {} }));
    } catch (e) { erroDoSegundo = e; }
  };
  R.executarGravacao(repo, amb, { idOp: "primeira" }, (tx) => {
    tx.inserir("Tutor", tutorBase());
    return { status: 201, corpo: {} };
  });
  assert.equal(erroDoSegundo.status, 503);
  assert.equal(repo.ler("Tutor").length, 1);
});

test("operação grande demais para o diário é recusada sem gravar", () => {
  const R = carregar();
  const repo = R.criarRepositorioMemoria();
  for (let i = 0; i < 100; i += 1) {   // 100 tutores com campo grande
    repo.aplicar([{ tabela: "Tutor", tipo: "inserir", linha: R.completarLinha("Tutor",
      tutorBase({ id_tutor: `t${i}`, nome: "N".repeat(1000) })) }]);
  }
  assert.throws(() => R.executarGravacao(repo, ambiente(R), {}, (tx) => {
    for (let i = 0; i < 100; i += 1) tx.atualizar("Tutor", `t${i}`, { nome: "curto" });
    return { status: 200, corpo: {} };
  }), { status: 413 });
  assert.equal(repo.ler("Tutor")[0].nome.length, 1000, "nada foi alterado");
});
