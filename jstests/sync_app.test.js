"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Drive = require("../web/drive-rest");
const Raiz = require("../web/raiz");
const Sinc = require("../web/sincronizacao");
const Agendador = require("../web/agendador");
const Ambiente = require("../web/ambiente-local");
const { criarSyncApp, descreverConflito } = require("../web/sync-app");
const { criarDriveFalso } = require("./drive_falso");
const { criarBase, criarAparelho, agendamento } = require("./aparelho_util");

function montar(ap, falso, conta) {
  const mudancas = [];
  const app = criarSyncApp({ motor: ap.motor, repo: ap.repo, Drive, Raiz, Sinc, Agendador, Ambiente,
    autorizar: async () => ({ accessToken: falso.estado.tokenValido, email: conta }),
    fetchImpl: falso.fetchImpl, timers: { set: () => 1, clear: () => {} },
    aparelho: ap.nome, aoMudar: (e) => mudancas.push(e) });
  app.mudancas = mudancas;
  return app;
}

test("conectar publica a base do primeiro aparelho; o segundo entra na clínica e vê tudo", async () => {
  const base = await criarBase();
  const f = criarDriveFalso();
  const a = await criarAparelho({ nome: "A", base, relogio: { ms: 1_000_000 } });
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", "529.982.247-25"));
  const appA = montar(a, f, "clinica@gmail.com");
  assert.equal(appA.estado(), "desconectado");
  assert.equal(await appA.conectar(), "clinica@gmail.com");
  assert.equal(appA.conta(), "clinica@gmail.com");
  await appA.sincronizarAgora();
  assert.equal(appA.estado(), "sincronizado");
  assert.ok(f.nomes().some((n) => n.startsWith("inst-")), "base publicada");

  // aparelho novo (estado vazio): não semeia nada, entra pela clínica do Drive
  const b = await criarAparelho({ nome: "B", base: null, relogio: { ms: 5_000 } });
  const appB = montar(b, f, "clinica@gmail.com");
  await appB.entrarNaClinica();
  await appB.sincronizarAgora();
  assert.equal(b.repo.ler("Usuario").length, 3);
  assert.equal(b.repo.ler("Atendimento").length, 1);
  assert.equal(b.estado(), a.estado());
});

test("o pedido de sincronização depois de gravar atualiza o estado para pendente quando falta enviar", async () => {
  const base = await criarBase();
  const f = criarDriveFalso();
  const a = await criarAparelho({ nome: "A", base });
  const app = montar(a, f, "x@gmail.com");
  await app.conectar();
  await app.sincronizarAgora();
  f.estado.falhas.push({ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 });
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", "529.982.247-25"));
  await app.sincronizarAgora();
  assert.equal(app.estado(), "erro");
  assert.equal(app.pendentes(), 1);
  f.estado.falhas.length = 0;
  await app.sincronizarAgora();
  assert.equal(app.estado(), "sincronizado");
  assert.equal(app.pendentes(), 0);
});

test("descrição dos conflitos para a lista", () => {
  const c = { metodo: "POST", caminho: "/api/agendamentos", corpo: { inicio: "2026-10-12T09:00",
    animal: { nome: "Rex" }, tutor: { nome: "João" } },
  motivo: { status: 409, detalhe: { codigo: "horario_ocupado", mensagem: "Horário já ocupado." } } };
  const d = descreverConflito(c);
  assert.equal(d.titulo, "Agendamento de Rex · João em 2026-10-12 09:00");
  assert.equal(d.porque, "Horário já ocupado.");
  assert.equal(descreverConflito({ metodo: "PUT", caminho: "/api/atendimentos/x/valores", corpo: {},
    motivo: { detalhe: "encerrado" } }).titulo, "Dados do atendimento");
});

test("a administração retira um aparelho; ele apaga o banco local e para de sincronizar", async () => {
  const base = await criarBase();
  const f = criarDriveFalso();
  const a = await criarAparelho({ nome: "A", base, relogio: { ms: 1_000_000 } });
  const appA = montar(a, f, "clinica@gmail.com");
  await appA.conectar();
  await appA.sincronizarAgora();

  const b = await criarAparelho({ nome: "B", base: null, relogio: { ms: 5_000 } });
  let aviso = null;
  const appB = criarSyncApp({ motor: b.motor, repo: b.repo, Drive, Raiz, Sinc, Agendador, Ambiente,
    autorizar: async () => ({ accessToken: f.estado.tokenValido, email: "clinica@gmail.com" }),
    fetchImpl: f.fetchImpl, timers: { set: () => 1, clear: () => {} }, aparelho: "B",
    nomeAparelho: () => "Celular da recepção",
    aoSerRetirado: async (r) => { aviso = r; await b.repo.apagarTudo(); } });
  await appB.entrarNaClinica();
  await appB.sincronizarAgora();
  assert.equal(b.repo.ler("Usuario").length, 3);

  const lista = await appA.aparelhos();
  assert.deepEqual(lista.map((x) => [x.id, x.nome, x.ativo, x.esteAparelho]),
    [["A", "A", true, true], ["B", "Celular da recepção", true, false]]);
  await assert.rejects(() => appA.retirarAparelho("A"), /não pode retirar a si mesmo/);
  await appA.retirarAparelho("B", { por: "admin@c.com", motivo: "celular perdido" });
  assert.equal((await appA.aparelhos()).find((x) => x.id === "B").ativo, false);

  await appB.sincronizarAgora();
  assert.equal(aviso.motivo, "celular perdido");
  assert.equal(appB.retirado().aparelho, "B");
  assert.equal(b.repo.ler("Usuario").length, 0);
});

test("autorização vencida: renova sozinha; sem conseguir renovar, pausa e mantém as operações", async () => {
  const base = await criarBase();
  const f = criarDriveFalso();
  const a = await criarAparelho({ nome: "A", base });
  let negar = false;
  let renovacoes = 0;
  const app = criarSyncApp({ motor: a.motor, repo: a.repo, Drive, Raiz, Sinc, Agendador, Ambiente,
    autorizar: async () => {
      renovacoes += 1;
      if (negar) throw Object.assign(new Error("negado"), { code: "negado" });
      return { accessToken: f.estado.tokenValido, email: "x@gmail.com" };
    },
    fetchImpl: f.fetchImpl, timers: { set: () => 1, clear: () => {} }, aparelho: "A" });
  await app.conectar();
  await app.sincronizarAgora();
  assert.equal(app.estado(), "sincronizado");
  const antes = renovacoes;

  // o Google passa a recusar o token em uso; o aplicativo consegue um novo e segue
  f.estado.tokenValido = "token-novo";
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-1", "2026-10-12T09:00", "529.982.247-25"));
  await app.sincronizarAgora();
  assert.equal(app.estado(), "sincronizado");
  assert.equal(app.pendentes(), 0);
  assert.ok(renovacoes > antes, "pediu novo token");

  // vence de novo e a renovação é negada: pausa, mas o trabalho local continua
  f.estado.tokenValido = "token-mais-novo";
  negar = true;
  await a.chamar("sec@c.com", "POST", "/api/agendamentos", agendamento("at-2", "2026-10-12T10:00", "111.444.777-35", "Outro"));
  await app.sincronizarAgora();
  assert.equal(app.estado(), "pausada");
  assert.equal(app.pendentes(), 1, "operação continua guardada");
  const local = await a.chamar("sec@c.com", "POST", "/api/agendamentos",
    agendamento("at-3", "2026-10-12T11:00", "390.533.447-05", "Terceiro"));
  assert.equal(local.status, 201, "continua funcionando no aparelho");

  // nova entrada: envia tudo
  negar = false;
  await app.sincronizarAgora();
  assert.equal(app.estado(), "sincronizado");
  assert.equal(app.pendentes(), 0);
});

test("pessoa convidada: sem a pasta compartilhada não entra nem cria outra; com ela, entra", async () => {
  const base = await criarBase();
  const f = criarDriveFalso();
  const b = await criarAparelho({ nome: "B", base: null, relogio: { ms: 5_000 } });
  const appB = montar(b, f, "veterinaria@gmail.com");
  await assert.rejects(() => appB.entrarNaClinica(), (e) => e.codigo === "sem_pasta"
    && /veterinaria@gmail.com/.test(e.message));
  assert.equal(f.pastas().length, 0, "não criou pasta própria");

  // a administração cria a clínica e compartilha a pasta com a pessoa
  const a = await criarAparelho({ nome: "A", base, relogio: { ms: 1_000_000 } });
  const appA = montar(a, f, "admin@gmail.com");
  await appA.conectar();
  await appA.sincronizarAgora();
  const conv = await appA.compartilharPasta("Veterinaria@gmail.com");
  assert.equal(conv.jaTinha, false);
  assert.deepEqual((await appA.compartilhamentos()).map((p) => p.email),
    ["dono@clinica.com", "veterinaria@gmail.com"]);

  await appB.entrarNaClinica();
  await appB.sincronizarAgora();
  assert.equal(b.repo.ler("Usuario").length, 3);
  assert.equal(f.pastas().filter((p) => p.name === "RoniVet").length, 1);

  // quem entrou por instantâneo nunca cria a pasta, mesmo se ela deixar de aparecer
  const cliente = await appA.retirarAcesso("veterinaria@gmail.com");
  assert.equal(cliente.removido, true);
});

test("entrarComConta identifica a pessoa e liga a sincronização", async () => {
  const base = await criarBase();
  const f = criarDriveFalso();
  const a = await criarAparelho({ nome: "A", base });
  const app = montar(a, f, "ana@gmail.com");
  assert.equal(await app.identificar(null), "ana@gmail.com");
  assert.equal(app.conectado(), false, "identificar não inicia a sincronização");
  assert.equal(await app.entrarComConta("ana@gmail.com"), "ana@gmail.com");
  assert.equal(app.conectado(), true);
});

test("modelo inicial é salvo na pasta modelos-iniciais da clínica e repetido sem erro", async () => {
  const base = await criarBase();
  const f = criarDriveFalso();
  const a = await criarAparelho({ nome: "A", base });
  const app = montar(a, f, "adm@gmail.com");
  assert.equal(await app.salvarModeloInicial("modelo-Vacina.docx", new Uint8Array([1, 2])), false);
  await app.conectar();
  assert.equal(await app.salvarModeloInicial("modelo-Vacina.docx", new Uint8Array([1, 2, 3])), true);
  assert.equal(await app.salvarModeloInicial("modelo-Vacina.docx", new Uint8Array([4, 5])), true);
  assert.equal(f.nomes().filter((n) => n === "modelo-Vacina.docx").length, 1);
});
