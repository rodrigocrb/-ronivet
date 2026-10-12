"use strict";

// Telas por perfil. O perfil organiza a navegação e a auditoria; não é controle de segurança
// (os dados ficam no aparelho; ver AVISO.md).
const TELAS = {
  agenda: { titulo: "Agenda", render: telaAgenda },
  campanha: { titulo: "Campanha", render: telaCampanha },
  painel: { titulo: "Painel", render: telaPainel },
  config: { titulo: "Configuração", render: (raiz) => telaConfig(raiz) },
  horarios: { titulo: "Horários de atendimento", render: (raiz) => telaConfig(raiz, "horarios") },
  tipos: { titulo: "Tipos de atendimento", render: (raiz) => telaConfig(raiz, "tipos") },
  pessoas: { titulo: "Pessoas", render: (raiz) => telaConfig(raiz, "pessoas") },
  atendimento: { titulo: "Atendimento", render: telaAtendimento, oculta: true },
};

const MENU_POR_PERFIL = {
  SECRETARIA: ["agenda", "campanha"],
  VETERINARIO: ["agenda", "painel"],
  ADMIN: ["agenda", "campanha", "painel", "horarios", "tipos", "pessoas", "config"],
};

const ROTULO_PERFIL = { ADMIN: "Administrador(a)", VETERINARIO: "Veterinário(a)", SECRETARIA: "Secretária" };

const $ = (id) => document.getElementById(id);
const estado = { usuario: null, credencial: null };

function el(tag, atributos = {}, ...filhos) {
  const no = document.createElement(tag);
  for (const [chave, valor] of Object.entries(atributos)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (chave === "class") no.className = valor;
    else if (chave.startsWith("on")) no.addEventListener(chave.slice(2), valor);
    else no.setAttribute(chave, valor);
  }
  for (const filho of filhos) no.append(filho);
  return no;
}

// Mascote (labrador preto) em SVG embutido: login, topo, estados vazios e confirmações.
function logo() {
  const no = el("span", { class: "logo", "aria-hidden": "true" });
  no.innerHTML = MASCOTE_SVG;  // constante do próprio sistema (mascote.js)
  return no;
}

function vazio(texto) {
  return el("div", { class: "vazio" }, logo(), el("p", {}, texto));
}

function novoUuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let syncApp = null;        // sincronização com o Drive (sync-app.js)
let localApp = null;       // banco, motor e regras no aparelho (local.js)

// Transporte para o núcleo local, definido em iniciar().
let transporte = null;

const noAppNativo = RoniGoogle.nativo;

/** Chamada à API do núcleo local; o banco está no aparelho, então não há fila nem espera de rede. */
async function api(caminho, opcoes = {}) {
  const resposta = await transporte.rede(caminho, opcoes);
  if (!resposta.ok) {
    const erro = new Error(`HTTP ${resposta.status}`);
    erro.status = resposta.status;
    try { erro.corpo = await resposta.json(); } catch (_) { erro.corpo = null; }
    throw erro;
  }
  if (syncApp && syncApp.conectado() && !/^GET$/i.test(opcoes.method || "GET")) {
    syncApp.sincronizarAgora().catch(() => {});   // logo depois de registrar, sem esperar 5 min
    atualizarIndicador();
  }
  return resposta.json();
}

// ---------- Credencial da pessoa (guardada no aparelho) ----------

const CHAVE_CREDENCIAL = "ronivet:credencial";
function credencialSalva() {
  try { return localStorage.getItem(CHAVE_CREDENCIAL); } catch (_) { return null; }
}
function guardarCredencial(valor) {
  try {
    if (valor) localStorage.setItem(CHAVE_CREDENCIAL, valor);
    else localStorage.removeItem(CHAVE_CREDENCIAL);
  } catch (_) { /* sem armazenamento local */ }
}

// ---------- Nome deste aparelho (aparece na lista de aparelhos da clínica) ----------

const ARQ_NOME_APARELHO = "local/nome-aparelho";
function nomeDoAparelho() {
  const padrao = `Aparelho ${localApp.aparelho.slice(0, 4)}`;
  return localApp.repo.existeArquivo(ARQ_NOME_APARELHO)
    ? (localApp.repo.lerArquivo(ARQ_NOME_APARELHO) || padrao) : padrao;
}
async function definirNomeDoAparelho(texto) {
  const nome = String(texto || "").trim().slice(0, 40);
  if (!nome) return nomeDoAparelho();
  localApp.repo.gravarArquivo(ARQ_NOME_APARELHO, nome);
  await localApp.repo.descarregar();
  return nome;
}

// ---------- Entrada ----------

function esconderTopo() {
  $("topo").hidden = true;
  fecharGaveta();
}

/** Entrada pela conta Google da pessoa (aplicativo) ou escolha da pessoa (navegador, teste). */
function mostrarLogin(mensagem) {
  esconderTopo();
  const app = $("app");
  app.replaceChildren(el("div", { class: "login-marca" }, logo(), el("h1", {}, "RoniVet")));
  if (mensagem) app.append(el("p", { class: "erro", role: "alert" }, mensagem));

  if (localApp.semClinica()) return mostrarPrimeiraAbertura(app);
  if (noAppNativo) return mostrarEntradaComGoogle(app);
  app.append(el("div", { class: "cartao", id: "quem-usa" }, el("h2", {}, "Quem está usando?"),
    ...localApp.pessoas().map((p) => el("button", { type: "button", class: "primario pessoa",
      "data-email": p.email, onclick: () => entrar(`fake:${p.email}`) },
    `${p.nome} · ${ROTULO_PERFIL[p.perfil] || p.perfil}`))));
}

/** Aparelho sem clínica: criar a clínica (administração) ou entrar numa clínica a que foi convidada. */
function mostrarPrimeiraAbertura(app) {
  const nome = el("input", { id: "clinica-nome", placeholder: "Seu nome", autocomplete: "name" });
  const email = el("input", { id: "clinica-email", type: "email", placeholder: "Seu e-mail",
    autocomplete: "email", hidden: noAppNativo ? "" : null });
  const ehVet = el("input", { id: "clinica-vet", type: "checkbox" });
  const crmv = el("input", { id: "clinica-crmv", placeholder: "CRMV (ex.: CRMV-SP 12345)" });
  const campoCrmv = el("div", { hidden: "" }, el("label", { for: "clinica-crmv" }, "CRMV"), crmv);
  ehVet.addEventListener("change", () => { campoCrmv.hidden = !ehVet.checked; });
  const erro = el("p", { id: "clinica-erro", class: "erro", role: "alert" });
  const nomeAparelho = el("input", { id: "aparelho-nome", maxlength: "40", autocomplete: "off",
    placeholder: "Ex.: Recepção, Celular da Dra. Ana" });
  nomeAparelho.value = nomeDoAparelho();
  app.append(el("div", { class: "cartao" },
    el("h2", {}, "Nome deste aparelho"),
    el("p", {}, el("small", {}, "Aparece na lista de aparelhos da clínica, para você reconhecê-lo.")),
    nomeAparelho));
  app.append(el("div", { class: "cartao" },
    el("h2", {}, "Primeira abertura"),
    el("p", {}, "Este aparelho ainda não tem uma clínica. Os dados ficam guardados aqui e "
      + "funcionam sem internet."),
    el("label", { for: "clinica-nome" }, "Seu nome"), nome,
    noAppNativo ? el("p", {}, el("small", {}, "A clínica será criada com a sua conta Google: "
      + "ela será a conta administradora e dona da pasta no Drive. Depois você cadastra a "
      + "equipe em Menu › Pessoas e cada pessoa recebe um convite do Google."))
      : el("label", { for: "clinica-email" }, "Seu e-mail"),
    email,
    el("label", { class: "interruptor", for: "clinica-vet" }, ehVet, " Sou veterinário(a)"),
    campoCrmv, erro,
    el("button", { type: "button", class: "primario", id: "criar-clinica", onclick: async () => {
      erro.textContent = "";
      try {
        await definirNomeDoAparelho(nomeAparelho.value);
        // No aplicativo, o e-mail é o da conta Google escolhida (verificado pelo Google).
        if (noAppNativo) email.value = await syncApp.identificar(null);
        const r = await localApp.criarClinica({ nome: nome.value, email: email.value,
          crmv: crmv.value, veterinario: ehVet.checked });
        if (noAppNativo) syncApp.conectar().catch(() => { /* tenta no ciclo seguinte */ });
        await entrar(`fake:${r.email}`);
      } catch (e) {
        erro.textContent = e.message || "Não foi possível criar a clínica.";
      }
    } }, "Criar a clínica neste aparelho")),
  el("div", { class: "cartao" },
    el("h2", {}, "Fui convidado(a) para uma clínica"),
    el("p", {}, "Entre com a sua conta Google, a mesma que a administração cadastrou. Os dados "
      + "da clínica vêm para este aparelho."),
    el("p", { id: "entrar-erro", class: "erro", role: "alert" }),
    el("button", { type: "button", id: "entrar-na-clinica", onclick: async (ev) => {
      const aviso = $("entrar-erro");
      aviso.textContent = "";
      if (!noAppNativo) {
        aviso.textContent = "Disponível no aplicativo Android.";
        return;
      }
      ev.currentTarget.disabled = true;
      aviso.className = "aviso";
      aviso.textContent = "Entrando na clínica… na primeira vez isso pode levar alguns minutos. "
        + "Não feche o aplicativo.";
      try {
        await definirNomeDoAparelho(nomeAparelho.value);
        await syncApp.entrarNaClinica();
        if (localApp.semClinica()) {
          aviso.className = "erro";
          aviso.textContent = "Nenhuma clínica encontrada nesta conta do Google.";
        } else {
          mostrarLogin();
        }
      } catch (e) {
        aviso.className = "erro";
        aviso.textContent = e && e.codigo === "sem_pasta" ? e.message
          : "Não foi possível conectar a conta Google. Tente novamente.";
      }
      ev.currentTarget.disabled = false;
    } }, "Entrar com a minha conta Google")));
}

/** Entrada da pessoa pela conta Google dela: o e-mail verificado define o perfil. */
function mostrarEntradaComGoogle(app) {
  let ultima = null;
  try { ultima = localStorage.getItem("ronivet:ultima-conta"); } catch (_) { /* sem armazenamento */ }
  const msg = el("p", { id: "entrar-google-erro", class: "erro", role: "alert" });
  const lista = el("div", { id: "escolher-entrada" });
  const concluir = async (email) => {
    const entradas = localApp.entradasDoEmail(email);
    if (!entradas.length) {
      msg.textContent = `A conta ${email} não está cadastrada na clínica. Peça à administração `
        + "para cadastrar este e-mail em Menu › Pessoas.";
      return;
    }
    try { localStorage.setItem("ronivet:ultima-conta", email); } catch (_) { /* ok */ }
    if (entradas.length === 1) { await entrar(`fake:${entradas[0].email}`); return; }
    lista.replaceChildren(el("p", {}, "Como deseja entrar?"),
      ...entradas.map((p) => el("button", { type: "button", class: "primario pessoa",
        "data-email": p.email, onclick: () => entrar(`fake:${p.email}`) },
      `${p.nome} · ${ROTULO_PERFIL[p.perfil] || p.perfil}`)));
  };
  const identificar = async (dica) => {
    msg.textContent = "";
    try {
      await concluir(await syncApp.entrarComConta(dica));
    } catch (e) {
      msg.textContent = e && e.code === "negado" ? "A identificação não foi autorizada."
        : "Não foi possível identificar a conta Google. Tente novamente.";
    }
  };
  app.append(el("div", { class: "cartao", id: "quem-usa" }, el("h2", {}, "Entrar"),
    el("p", {}, "Entre com a sua conta Google para usar o RoniVet com o seu nome. É a conta com "
      + "a qual a administração compartilhou a pasta da clínica."),
    ultima ? el("button", { type: "button", class: "primario", id: "entrar-como-ultima",
      onclick: () => identificar(ultima) }, `Entrar como ${ultima}`) : "",
    el("button", { type: "button", class: ultima ? "" : "primario", id: "entrar-google",
      onclick: () => identificar(null) }, ultima ? "Usar outra conta Google"
      : "Entrar com a conta Google"),
    msg, lista));
}

async function entrar(credencial) {
  try {
    estado.credencial = credencial;
    estado.usuario = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ credential: credencial }),
    });
    guardarCredencial(credencial);
    iniciarApp();
  } catch (erro) {
    estado.credencial = null;
    mostrarLogin(erro.status === 403 || erro.status === 401
      ? "Esta pessoa não está autorizada. Fale com a administração."
      : "Não foi possível entrar. Tente novamente.");
  }
}

function sair() {
  fecharGaveta();
  try {
    Object.keys(localStorage).filter((k) => k.startsWith("ronivet:rascunho:"))
      .forEach((k) => localStorage.removeItem(k));
  } catch (_) { /* sem armazenamento local */ }
  guardarCredencial(null);
  estado.credencial = null;
  estado.usuario = null;
  mostrarLogin();
}

// ---------- Aparelho retirado ----------

function mostrarAparelhoRetirado() {
  estado.usuario = null;
  esconderTopo();
  $("app").replaceChildren(el("div", { class: "login-marca" }, logo(), el("h1", {}, "RoniVet")),
    el("div", { class: "cartao", id: "aparelho-retirado" },
      el("h2", {}, "Este aparelho foi retirado da clínica"),
      el("p", {}, "Os dados da clínica foram apagados deste aparelho. Para usá-lo de novo, "
        + "feche e abra o aplicativo e entre com a sua conta Google.")));
}

// ---------- Indicador de sincronização ----------

async function atualizarIndicador() {
  const rede = $("rede");
  const botao = $("pendencias");
  if (!rede || !botao || !syncApp) return;
  const e = syncApp.estado();
  const problema = ["erro", "pausada", "sem_conexao"].includes(e);
  rede.textContent = syncApp.conectado() && e !== "sincronizado" ? syncApp.rotuloEstado() : "";
  rede.className = problema ? "rede-offline" : "";
  const conflitos = syncApp.conflitos().length;
  // O botão só aparece quando há algo a conferir; o resto fica na gaveta (Sincronização).
  botao.hidden = !estado.usuario || !(conflitos || syncApp.pendentes());
  botao.textContent = conflitos ? `${conflitos} conflito(s)` : `${syncApp.pendentes()} pendente(s)`;
  atualizarSeloSincronizacao();
}

function atualizarSeloSincronizacao() {
  const selo = $("selo-sincronizacao");
  if (!selo || !estado.usuario || !syncApp) return;
  const c = syncApp.conflitos().length;
  const p = syncApp.pendentes();
  const texto = c ? `${c} conflito(s)` : (p ? `${p} pendente(s)` : "");
  selo.textContent = texto;
  selo.hidden = !texto;
}

// ---------- Sincronização, aparelhos e conflitos ----------

function cartaoNomeAparelho() {
  const campo = el("input", { id: "nome-aparelho", maxlength: "40", autocomplete: "off" });
  campo.value = nomeDoAparelho();
  const aviso = el("small", { id: "nome-aparelho-aviso", role: "status" });
  return el("div", { class: "cartao", id: "cartao-nome-aparelho" },
    el("h2", {}, "Nome deste aparelho"), campo,
    el("button", { type: "button", id: "salvar-nome-aparelho", onclick: async () => {
      await definirNomeDoAparelho(campo.value);
      aviso.textContent = "Nome salvo. Aparece para os outros aparelhos na próxima sincronização.";
      if (syncApp.conectado()) syncApp.sincronizarAgora().catch(() => {});
    } }, "Salvar nome"), aviso);
}

// Lista de aparelhos da clínica, com a retirada (só administração, com conexão).
function cartaoAparelhos() {
  const corpo = el("div", {}, el("p", {}, "Carregando…"));
  const cartao = el("div", { class: "cartao", id: "lista-aparelhos" }, el("h2", {}, "Aparelhos da clínica"),
    el("p", {}, el("small", {}, "Retire um aparelho perdido ou fora de uso: ao se conectar, ele apaga "
      + "os dados da clínica. O que ele já enviou continua valendo.")), corpo);
  syncApp.aparelhos().then((lista) => {
    corpo.replaceChildren(...lista.map((a) => {
      const linha = el("div", { class: "atendimento" });
      linha.append(el("strong", {}, a.nome + (a.esteAparelho ? " (este)" : "")),
        el("small", {}, ` ${a.id.slice(0, 8)}`));
      if (!a.ativo) {
        linha.append(el("div", { class: "aviso" }, `Retirado${a.retirada && a.retirada.motivo
          ? `: ${a.retirada.motivo}` : ""}`));
      } else if (!a.esteAparelho) {
        const motivo = el("input", { placeholder: "Motivo (ex.: celular perdido)" });
        const confirmar = el("button", { type: "button", class: "descartar", hidden: "", onclick: async () => {
          try {
            await syncApp.retirarAparelho(a.id, { por: estado.usuario && estado.usuario.email,
              motivo: motivo.value.trim() });
            mostrarSincronizacao();
          } catch (e) {
            linha.append(el("div", { class: "erro", role: "alert" }, e.message));
          }
        } }, "Confirmar retirada");
        linha.append(motivo, el("button", { type: "button", class: "retirar", onclick: (ev) => {
          confirmar.hidden = false;
          ev.currentTarget.hidden = true;
        } }, "Retirar"), confirmar);
      }
      return linha;
    }));
    if (!lista.length) corpo.replaceChildren(el("p", {}, "Nenhum aparelho registrado ainda."));
  }).catch(() => {
    corpo.replaceChildren(el("p", { class: "erro" }, "Não foi possível ler os aparelhos agora."));
  });
  return cartao;
}

// Estado da sincronização com o Drive, conta Google e conflitos a conferir.
async function mostrarSincronizacao() {
  const conflitos = syncApp.conflitos();
  const msg = el("p", { id: "sync-mensagem", role: "alert" });
  const erroDe = (e) => {
    if (e && (e.code === "10" || e.code === "8")) {
      return "Este aplicativo ainda não está cadastrado no Google (erro " + e.code + "). "
        + "Quem publicou o aplicativo precisa concluir o cadastro.";
    }
    if (e && e.code === "negado") return "O acesso ao Drive não foi autorizado.";
    if (e && e.codigo === "sem_pasta") return e.message;
    return "Não foi possível conectar a conta Google. Tente novamente.";
  };
  const conectar = async () => {
    msg.textContent = "";
    try {
      await syncApp.conectar();
      await syncApp.sincronizarAgora();
      mostrarSincronizacao();
    } catch (e) {
      msg.className = "erro";
      msg.textContent = erroDe(e);
    }
  };
  const resultado = syncApp.ultimoResultado();
  const erros = (resultado && resultado.erros) || [];
  $("app").replaceChildren(
    el("h1", {}, "Sincronização"),
    el("div", { class: "cartao" },
      el("p", { id: "sync-estado" }, `Estado: ${syncApp.rotuloEstado()}`),
      el("p", {}, syncApp.conta() ? `Conta Google: ${syncApp.conta()}` : "Nenhuma conta Google conectada."),
      el("p", {}, `Operações aguardando envio: ${syncApp.pendentes()}`),
      erros.length ? el("p", { class: "erro" }, `Último erro: ${erros[0].motivo}`) : "",
      noAppNativo ? "" : el("p", { class: "aviso" },
        "A conexão com o Google Drive está disponível no aplicativo Android."),
      el("div", { class: "acoes" },
        noAppNativo ? el("button", { type: "button", class: "primario", id: "conectar-google", onclick: conectar },
          syncApp.estado() === "pausada" ? "Entrar de novo na conta Google"
            : (syncApp.conectado() ? "Trocar/reconectar conta Google" : "Conectar conta Google")) : "",
        syncApp.conectado() ? el("button", { type: "button", id: "sincronizar-agora", onclick: async () => {
          await syncApp.sincronizarAgora();
          mostrarSincronizacao();
        } }, "Sincronizar agora") : ""),
      msg),
    el("div", { class: "cartao", id: "lista-conflitos" }, el("h2", {}, "Conflitos para conferir"),
      el("p", {}, el("small", {}, "Quando dois aparelhos registram algo incompatível (por exemplo, o "
        + "mesmo horário), vale o que veio primeiro. O outro aparece aqui para ser refeito.")),
      ...(conflitos.length ? conflitos.map((c) => el("div", { class: "atendimento recusada" },
        el("strong", {}, c.titulo), el("div", { class: "erro" }, c.porque),
        el("small", {}, `${c.pessoa} · aparelho ${c.aparelho.slice(0, 8)} · ${String(c.hora).replace("T", " ").slice(0, 16)}`),
        el("button", { type: "button", class: "descartar", onclick: async () => {
          localApp.motor.resolverConflito(c.id);
          await localApp.repo.descarregar();
          await atualizarIndicador();
          mostrarSincronizacao();
        } }, "Conferido")))
        : [vazio("Nenhum conflito.")])),
    estado.usuario && estado.usuario.perfil === "ADMIN" && syncApp.conectado() ? cartaoAparelhos() : "",
    cartaoNomeAparelho(),
    el("p", {}, el("small", {}, `Identificador: ${localApp.aparelho}`)),
    el("button", { type: "button", onclick: () => desenharTela() }, "Voltar"));
}

// ---------- Navegação e menu ----------

function rotaAtual() {
  const permitidas = MENU_POR_PERFIL[estado.usuario.perfil] || [];
  const [pedida, parametro] = location.hash.replace(/^#\/?/, "").split("/");
  if (pedida === "atendimento" && parametro && ["VETERINARIO", "ADMIN"].includes(estado.usuario.perfil)) {
    return { id: "atendimento", parametro, menu: "agenda" };
  }
  const id = permitidas.includes(pedida) ? pedida : permitidas[0];
  return { id, parametro: null, menu: id };
}

function telaAtual() {
  return rotaAtual().id;
}

function fecharGaveta() {
  const g = $("gaveta");
  if (!g) return;
  g.hidden = true;
  $("gaveta-fundo").hidden = true;
  $("abrir-menu").setAttribute("aria-expanded", "false");
}

function abrirGaveta() {
  desenharMenu();
  $("gaveta").hidden = false;
  $("gaveta-fundo").hidden = false;
  $("abrir-menu").setAttribute("aria-expanded", "true");
}

// Menu em gaveta (hambúrguer): telas do perfil, sincronização e saída.
function desenharMenu() {
  const menu = $("menu");
  const atual = rotaAtual().menu;
  const perfil = estado.usuario.perfil;
  const ids = MENU_POR_PERFIL[perfil] || [];
  const clinico = ["VETERINARIO", "ADMIN"].includes(perfil);
  const rotulo = (id) => (id === "agenda" && clinico ? "Agenda e atendimentos" : TELAS[id].titulo);
  const link = (id) => {
    const a = el("a", { href: `#/${id}` }, rotulo(id));
    if (id === atual) a.setAttribute("aria-current", "page");
    a.addEventListener("click", fecharGaveta);
    return a;
  };
  // Itens de administração ficam em grupo próprio; "config" (tudo junto) só por endereço.
  const ADMINISTRACAO = ["horarios", "tipos", "pessoas"];
  const dia = ids.filter((id) => id !== "config" && !ADMINISTRACAO.includes(id));
  const admin = ADMINISTRACAO.filter((id) => ids.includes(id)).map(link);
  admin.push(el("button", { type: "button", class: "item", id: "menu-sincronizacao",
    onclick: () => { fecharGaveta(); mostrarSincronizacao(); } },
  el("span", {}, "Sincronização"), el("span", { class: "selo", id: "selo-sincronizacao", hidden: "" })));
  menu.replaceChildren(...dia.map(link),
    ...(perfil === "ADMIN" ? [el("div", { class: "grupo" }, "Administração")] : []), ...admin);
  atualizarSeloSincronizacao();
}

function desenharTela() {
  const rota = rotaAtual();
  desenharMenu();
  const tela = TELAS[rota.id];
  const raiz = $("app");
  raiz.replaceChildren(el("h1", {}, tela.titulo));
  if (tela.render) tela.render(raiz, rota.parametro);
  else raiz.append(el("div", { class: "cartao" }, "Em construção."));
}

function iniciarApp() {
  $("topo").hidden = false;
  if (!$("logo-topo").firstChild) $("logo-topo").innerHTML = MASCOTE_SVG;
  $("usuario").textContent = estado.usuario.nome;
  $("usuario-perfil").textContent = ROTULO_PERFIL[estado.usuario.perfil] || estado.usuario.perfil;
  desenharTela();
  atualizarIndicador();
}

// ---------- Inicialização ----------

async function iniciar() {
  $("sair").addEventListener("click", sair);
  $("abrir-menu").addEventListener("click", () => ($("gaveta").hidden ? abrirGaveta() : fecharGaveta()));
  $("gaveta-fundo").addEventListener("click", fecharGaveta);
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") fecharGaveta(); });
  $("pendencias").addEventListener("click", mostrarSincronizacao);
  window.addEventListener("hashchange", () => estado.usuario && desenharTela());
  window.addEventListener("online", () => {
    atualizarIndicador();
    if (syncApp && syncApp.conectado()) syncApp.sincronizarAgora().catch(() => {});
  });
  window.addEventListener("offline", atualizarIndicador);

  try {
    localApp = await RoniLocal.iniciar({ R: RoniVet, indexedDB: window.indexedDB, uuid: novoUuid,
      Armazenamento: RoniRepositorioLocal, Ambiente: RoniAmbienteLocal, Registro: RoniRegistro,
      Pdf: RoniPdfTexto, Documento: RoniDocumentoLocal, agoraIso: () => RoniTransporte.agoraIso() });
    let contaSalva = null;
    try { contaSalva = localStorage.getItem("ronivet:conta-google"); } catch (_) { /* sem armazenamento */ }
    syncApp = RoniSyncApp.criarSyncApp({
      motor: localApp.motor, repo: localApp.repo, aparelho: localApp.aparelho,
      Drive: RoniDriveRest, Raiz: RoniRaiz, Sinc: RoniSincronizacao, Agendador: RoniAgendador,
      Ambiente: RoniAmbienteLocal, docx: RoniDocx, contaInicial: contaSalva,
      autorizar: (conta) => RoniGoogle.autorizarDrive(conta),
      criarFluxo: (drive) => RoniDocumentoFluxo.criarFluxoDocumentos({ R: RoniVet,
        repo: localApp.repo, motor: localApp.motor, drive, documentos: localApp.documentos,
        sha256: RoniAmbienteLocal.sha256, docx: RoniDocx,
        agoraIso: () => RoniTransporte.agoraIso() }),
      fetchImpl: (...a) => fetch(...a),
      timers: { set: (f, ms) => setTimeout(f, ms), clear: (i) => clearTimeout(i) },
      online: () => navigator.onLine,
      nomeAparelho: () => nomeDoAparelho(),
      agoraIso: () => RoniTransporte.agoraIso(),
      aoSerRetirado: async () => {
        await localApp.repo.apagarTudo();
        try { localStorage.removeItem("ronivet:conta-google"); } catch (_) { /* ok */ }
        guardarCredencial(null);
        mostrarAparelhoRetirado();
      },
      aoMudarConta: (c) => { try { localStorage.setItem("ronivet:conta-google", c); } catch (_) { /* ok */ } },
      aoMudar: () => {
        atualizarIndicador();
        document.dispatchEvent(new CustomEvent("ronivet:dados-sincronizados"));
      },
    });
    if (noAppNativo && contaSalva) syncApp.retomar().catch(() => {});
  } catch (e) {
    $("app").replaceChildren(el("p", { class: "erro", role: "alert" },
      "Não foi possível abrir o banco de dados deste aparelho."));
    return;
  }
  transporte = RoniTransporte.criarTransporte({ obterCredencial: async () => estado.credencial,
    local: localApp.opcoesTransporte });

  // Entrada automática da pessoa que já usava este aparelho.
  const salva = credencialSalva();
  if (salva && !localApp.semClinica()) {
    estado.credencial = salva;
    try {
      estado.usuario = await api("/api/auth/me");
      iniciarApp();
      return;
    } catch (_) {
      estado.credencial = null;
      guardarCredencial(null);
    }
  }
  mostrarLogin();
}

// Aplicativo Android: nenhum service worker (os arquivos já são locais); remove qualquer um
// registrado por versões anteriores.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((rs) => rs.forEach((r) => r.unregister())).catch(() => {});
}

iniciar();
