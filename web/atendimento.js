"use strict";
// Tela do atendimento: ficha clínica dinâmica, encerramento, documento e aditamentos.

function chaveRascunho(id) { return `ronivet:rascunho:${id}`; }

function lerRascunho(id) {
  try { return JSON.parse(localStorage.getItem(chaveRascunho(id)) || "null"); } catch (_) { return null; }
}
function gravarRascunho(id, valores) {
  try { localStorage.setItem(chaveRascunho(id), JSON.stringify(valores)); } catch (_) { /* sem armazenamento */ }
}
function limparRascunho(id) {
  try { localStorage.removeItem(chaveRascunho(id)); } catch (_) { /* ignora */ }
}

function controleDoCampo(campo, valor, somenteLeitura) {
  const atributos = { id: `f-${campo.nome}`, "data-campo": campo.nome };
  if (somenteLeitura) atributos.disabled = "";
  let controle;
  if (campo.tipo_dado === "LISTA" || campo.tipo_dado === "SIMNAO") {
    const opcoes = campo.tipo_dado === "SIMNAO"
      ? [["SIM", "Sim"], ["NAO", "Não"]] : campo.opcoes.map((o) => [o, o]);
    controle = el("select", atributos, el("option", { value: "" }, "—"),
      ...opcoes.map(([v, r]) => el("option", { value: v }, r)));
  } else if (campo.tipo_dado === "DATA") {
    controle = el("input", { ...atributos, type: "date" });
  } else if (campo.tipo_dado === "NUMERO") {
    controle = el("input", { ...atributos, type: "text", inputmode: "decimal" });
  } else {
    controle = el("textarea", { ...atributos, rows: "2" });
  }
  controle.value = valor || "";
  return controle;
}

async function telaAtendimento(raiz, id) {
  // Veterinário, ou administrador com CRMV cadastrado (quem também atende).
  const vet = estado.usuario.perfil === "VETERINARIO"
    || (estado.usuario.perfil === "ADMIN" && !!(estado.usuario.crmv || "").trim());
  let ficha, resumo;
  try {
    [ficha, resumo] = await Promise.all([
      api(`/api/atendimentos/${id}/ficha`), api(`/api/atendimentos/${id}`)]);
  } catch (_) {
    raiz.append(el("p", { class: "erro" }, "Não foi possível abrir o atendimento."));
    return;
  }
  const encerrado = ficha.status === "ENCERRADO";
  const editavel = ficha.editavel && vet;
  const mensagem = el("p", { id: "mensagem", role: "status" });
  const rascunho = editavel ? lerRascunho(id) : null;
  const controles = new Map();

  const formulario = el("div", { class: "cartao", id: "ficha" });
  for (const campo of ficha.campos) {
    const valor = rascunho && campo.nome in rascunho ? rascunho[campo.nome] : ficha.valores[campo.nome];
    const controle = controleDoCampo(campo, valor, !editavel || campo.ativo === "NAO");
    controles.set(campo.nome, controle);
    controle.addEventListener("input", () => gravarRascunho(id, coletar()));
    formulario.append(
      el("label", { for: controle.id }, campo.rotulo + (campo.obrigatorio ? " *" : "")),
      controle, el("div", { class: "erro", id: `erro-${campo.nome}` }));
  }

  const coletar = () => {
    const saida = {};
    for (const [nome, ctl] of controles) if (!ctl.disabled) saida[nome] = ctl.value;
    return saida;
  };

  const mostrarErros = (e) => {
    document.querySelectorAll("[id^='erro-']").forEach((n) => { n.textContent = ""; });
    const d = e.corpo && e.corpo.detail;
    if (d && d.erros) {
      for (const [nome, texto] of Object.entries(d.erros)) {
        const alvo = document.getElementById(`erro-${nome}`);
        if (alvo) alvo.textContent = texto;
      }
      mensagem.className = "erro"; mensagem.textContent = "Corrija os campos indicados.";
    } else if (d && d.campos) {
      mensagem.className = "erro";
      mensagem.textContent = `Preencha os campos obrigatórios: ${d.campos.join(", ")}.`;
    } else if (d && d.codigo === "versao_desatualizada") {
      mensagem.className = "erro";
      mensagem.textContent = "Este atendimento foi alterado em outro aparelho. Volte à agenda e abra de novo.";
    } else if (d && d.mensagem) {
      mensagem.className = "erro"; mensagem.textContent = d.mensagem;
    } else {
      mensagem.className = "erro"; mensagem.textContent = "Não foi possível concluir a operação.";
    }
  };

  const salvar = async () => {
    const resposta = await api(`/api/atendimentos/${id}/valores`, { method: "PUT",
      body: JSON.stringify({ valores: coletar(), versao: ficha.versao }) });
    ficha.versao = resposta.versao;
    limparRascunho(id);
    return resposta;
  };

  const botoes = [];
  if (editavel) {
    botoes.push(
      el("button", { type: "button", id: "salvar", onclick: async () => {
        try { await salvar(); mensagem.className = ""; mensagem.textContent = "Dados salvos."; }
        catch (e) { mostrarErros(e); }
      } }, "Salvar"),
      el("button", { type: "button", class: "primario", id: "encerrar", onclick: async () => {
        try {
          await salvar();
          await api(`/api/atendimentos/${id}/encerrar`, { method: "POST" });
          desenharTela();   // o documento é gerado depois, quando houver conexão com o Drive
        } catch (e) { mostrarErros(e); }
      } }, "Encerrar atendimento"));
  }

  const cabecalho = el("div", { class: "cartao" },
    el("strong", {}, `${resumo.tipo} · ${resumo.inicio.slice(11)} · ${resumo.inicio.slice(0, 10)}`),
    el("div", {}, `${resumo.animal} (${resumo.especie}) · ${resumo.tutor}`),
    el("span", { class: "etiqueta" }, ROTULO_STATUS[resumo.status]));

  raiz.append(cabecalho);
  if (resumo.id_animal) await secaoPaciente(raiz, resumo.id_animal);
  raiz.append(formulario, mensagem, el("div", { class: "acoes" }, ...botoes));
  if (rascunho) {
    mensagem.className = "aviso";
    mensagem.textContent = "Rascunho recuperado deste aparelho. Salve para gravar no atendimento.";
  }
  if (encerrado) await secaoEncerrado(raiz, id, vet);
}

async function secaoEncerrado(raiz, id, vet) {
  const verificacao = el("p", { id: "verificacao" });
  const podeEmitir = ["VETERINARIO", "ADMIN"].includes(estado.usuario.perfil);
  // Nova emissão: a partir dos dados, quando o arquivo não existe mais ou não confere.
  const novaVia = el("button", { type: "button", id: "nova-via", hidden: "", onclick: async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      await api(`/api/atendimentos/${id}/documento/reemitir`, { method: "POST", body: "{}" });
      mostrar("Gerando a nova via…", false);
      if (syncApp.conectado()) await syncApp.sincronizarAgora();
      desenharTela();
    } catch (e) {
      ev.currentTarget.disabled = false;
      mostrar("Não foi possível emitir a nova via agora.", true);
    }
  } }, "Emitir nova via");
  const gerarAgora = el("button", { type: "button", id: "gerar-agora", hidden: "", onclick: async (ev) => {
    ev.currentTarget.disabled = true;
    mostrar("Gerando o documento…", false);
    try { await syncApp.sincronizarAgora(); } catch (_) { /* o estado mostra o erro */ }
    desenharTela();
  } }, "Gerar agora");
  // O documento vem do contrato em base64 (sem URL própria): abre no visualizador do aparelho.
  const mostrar = (texto, erro) => {
    verificacao.textContent = texto;
    verificacao.className = erro ? "erro" : "";
  };
  const comDocumento = (acao) => async () => {
    try {
      // O PDF vive no Drive: baixa, confere o hash e abre.
      const r = await syncApp.obterDocumento(id);
      const avisos = {
        pendente: "O documento ainda está sendo gerado. Ele fica pronto quando o aparelho "
          + "sincronizar com o Google Drive.",
        sem_conexao: "Conecte a conta Google (tela Sincronização) para abrir o documento.",
        ausente: "O arquivo não está mais no Drive. O comprovante continua nos dados do "
          + "atendimento; é possível emitir uma nova via. O registro da via original fica no histórico.",
        divergente: "ATENÇÃO: o arquivo no Drive não confere com o hash registrado. Se foi "
          + "alterado por engano, emita uma nova via; o registro da original fica no histórico.",
        sem_documento: "Este atendimento não tem documento.",
      };
      if (r.estado !== "ok") {
        mostrar(avisos[r.estado] || "Não foi possível abrir o documento.", r.estado === "divergente");
        if ((r.estado === "ausente" || r.estado === "divergente") && podeEmitir) {
          novaVia.hidden = false;
        }
        return;
      }
      const doc = { base64: RoniAmbienteLocal.paraBase64(r.bytes),
        nome_arquivo: String(r.nome || "documento.pdf").split("/").pop() };
      await acao(doc, window.RoniDocumentoUi.ambienteDoNavegador(window));
    } catch (_) {
      mostrar("Não foi possível baixar o documento do Drive. Confira a conexão e tente de novo.", true);
    }
  };
  const abrir = comDocumento((doc, amb) => window.RoniDocumentoUi.abrir(doc, amb));
  const imprimir = comDocumento((doc, amb) => window.RoniDocumentoUi.imprimir(doc, amb));
  const adicionados = el("div", { id: "aditamentos" });
  const texto = el("textarea", { id: "aditamento-texto", rows: "3", placeholder: "Correção ou complemento" });

  const carregarAditamentos = async () => {
    const lista = await api(`/api/atendimentos/${id}/aditamentos`);
    adicionados.replaceChildren(...(lista.length ? lista.map((a) =>
      el("div", { class: "atendimento" }, el("div", {}, a.texto),
        el("small", {}, `${a.autor} · ${a.criado_em.replace("T", " ").slice(0, 16)}`)))
      : [el("p", {}, "Nenhum aditamento.")]));
  };

  raiz.append(el("div", { class: "cartao" },
    el("h2", {}, "Documento"),
    el("div", { class: "acoes" },
      el("button", { type: "button", id: "abrir-pdf", class: "botao", onclick: abrir }, "Abrir PDF"),
      el("button", { type: "button", id: "imprimir", onclick: imprimir }, "Imprimir"),
      gerarAgora, novaVia),
    verificacao));
  raiz.append(el("div", { class: "cartao" }, el("h2", {}, "Aditamentos"), adicionados,
    vet ? el("div", {}, texto, el("button", { type: "button", class: "primario", id: "salvar-aditamento",
      onclick: async () => {
        if (!texto.value.trim()) return;
        await api(`/api/atendimentos/${id}/aditamentos`, { method: "POST",
          body: JSON.stringify({ texto: texto.value }) });
        texto.value = "";
        carregarAditamentos();
      } }, "Registrar aditamento")) : ""));
  carregarAditamentos();
  try {
    const v = await api(`/api/atendimentos/${id}/verificacao`);
    if (v.ok === null) {   // modo local: o arquivo está no Drive e é conferido ao abrir
      verificacao.className = "";
      if (v.estado === "PENDENTE") {
        document.getElementById("abrir-pdf").disabled = true;
        document.getElementById("imprimir").disabled = true;
        const u = syncApp.ultimoResultado();
        const falha = u && (u.erros || []).find((e) => e.etapa === "documentos");
        if (!syncApp.conectado()) {
          verificacao.textContent = "O documento será gerado quando a conta Google estiver "
            + "conectada (tela Sincronização). O atendimento já está encerrado.";
        } else if (falha) {
          verificacao.textContent = `Não foi possível gerar o documento (${falha.motivo}). Uma nova `
            + "tentativa acontece na próxima sincronização.";
          verificacao.className = "erro";
          gerarAgora.hidden = false;
        } else {
          verificacao.textContent = "Documento sendo gerado pelo Google Drive. Aparece aqui "
            + "quando o aparelho sincronizar.";
          gerarAgora.hidden = false;
        }
      } else {
        verificacao.textContent = "Documento guardado no Google Drive. A integridade é conferida "
          + "ao abri-lo.";
      }
      return;
    }
    verificacao.textContent = v.ok ? "Integridade verificada (hash confere)." : "ATENÇÃO: o arquivo não confere com o hash registrado.";
    verificacao.className = v.ok ? "" : "erro";
  } catch (_) { verificacao.textContent = ""; }
}

// Dados do paciente: o veterinário completa sexo, raça, nascimento e pelagem durante o
// atendimento (o tutor continua sendo cadastro da secretária).
async function secaoPaciente(raiz, idAnimal) {
  let animal;
  try { animal = await api(`/api/animais/${idAnimal}`); } catch (_) { return; }
  const edita = ["VETERINARIO", "ADMIN"].includes(estado.usuario.perfil);
  const atributos = edita ? {} : { disabled: "" };
  const sexo = el("select", { id: "p-sexo", ...atributos },
    el("option", { value: "INDEFINIDO" }, "Indefinido"),
    el("option", { value: "MACHO" }, "Macho"), el("option", { value: "FEMEA" }, "Fêmea"));
  sexo.value = animal.sexo || "INDEFINIDO";
  const raca = el("input", { id: "p-raca", autocomplete: "off", ...atributos });
  raca.value = animal.raca || "";
  const nasc = el("input", { id: "p-nascimento", type: "date", ...atributos });
  nasc.value = animal.data_nascimento || "";
  const pelagem = el("input", { id: "p-pelagem", autocomplete: "off", ...atributos });
  pelagem.value = animal.pelagem || "";
  const status = el("small", { id: "p-status", role: "status" });
  const cartao = el("details", { class: "cartao", id: "paciente", open: animal.sexo === "INDEFINIDO" ? "" : null },
    el("summary", {}, `Dados do paciente · ${animal.nome} (${animal.especie})`),
    el("label", { for: "p-sexo" }, "Sexo"), sexo,
    el("label", { for: "p-raca" }, "Raça"), raca,
    el("label", { for: "p-nascimento" }, "Nascimento"), nasc,
    el("label", { for: "p-pelagem" }, "Pelagem"), pelagem);
  if (edita) {
    cartao.append(el("button", { type: "button", id: "p-salvar", onclick: async () => {
      try {
        await api(`/api/animais/${idAnimal}`, { method: "PATCH", body: JSON.stringify({
          sexo: sexo.value, raca: raca.value.trim() || null,
          data_nascimento: nasc.value || null, pelagem: pelagem.value.trim() || null }) });
        status.textContent = "Dados do paciente salvos.";
      } catch (e) {
        status.textContent = e.status === 0
          ? "Salvar os dados do paciente exige conexão com o servidor."
          : "Não foi possível salvar os dados do paciente.";
      }
    } }, "Salvar dados do paciente"), status);
  }
  raiz.append(cartao);
}
