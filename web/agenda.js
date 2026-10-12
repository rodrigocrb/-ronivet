"use strict";
// Agenda: a única tela de operação do dia a dia. Busca, agendamento guiado (tutor, animal e
// horário em passos que aparecem conforme o preenchimento), remarcação, cancelamento e
// abertura do atendimento pelo toque.

const ROTULO_STATUS = { AGENDADO: "Agendado", CANCELADO: "Cancelado", ENCERRADO: "Encerrado" };
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const ESPECIES_COMUNS = ["Cão", "Gato", "Ave", "Equino", "Roedor"];
const ROTULO_CAMPO = {
  inicio: "horário", id_tipo: "tipo de atendimento", "tutor.nome": "nome do tutor",
  "tutor.telefone": "telefone do tutor", "animal.nome": "nome do animal",
  "animal.especie": "espécie do animal",
};

function hojeISO() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function somarDias(iso, n) {
  const [a, m, d] = iso.split("-").map(Number);
  const data = new Date(a, m - 1, d + n);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

function inicioDaSemana(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return somarDias(iso, -new Date(a, m - 1, d).getDay());
}

function rotuloDia(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return `${DIAS_SEMANA[new Date(a, m - 1, d).getDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

function soDigitosUI(texto) { return String(texto || "").replace(/\D/g, ""); }

function mascararCpf(cpf) {
  const d = soDigitosUI(cpf);
  return d.length === 11 ? `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**` : "";
}

// Procura o tutor por um único campo: CPF, nome ou telefone. Com 11 dígitos pode ser um CPF
// ou um celular com DDD; as duas consultas são feitas e os resultados reunidos.
async function procurarTutores(texto) {
  const termo = texto.trim();
  const digitos = soDigitosUI(termo);
  if (termo.length < 2 && digitos.length < 3) return [];
  const consultas = [api(`/api/tutores?q=${encodeURIComponent(termo)}`).catch(() => [])];
  if (digitos.length === 11 && RoniVet.cpf.valido(digitos)) {
    consultas.unshift(api(`/api/tutores?cpf=${digitos}`).catch(() => []));
  }
  const vistos = new Map();
  for (const lista of await Promise.all(consultas)) {
    for (const t of lista) if (!vistos.has(t.id)) vistos.set(t.id, t);
  }
  return [...vistos.values()];
}

function telaAgenda(raiz) {
  const podeAgendar = ["SECRETARIA", "ADMIN"].includes(estado.usuario.perfil);
  const abreAtendimento = ["VETERINARIO", "ADMIN"].includes(estado.usuario.perfil);
  const seletor = el("input", { id: "agenda-data", type: "date", value: hojeISO() });
  const modo = el("select", { id: "agenda-modo" },
    el("option", { value: "dia" }, "Dia"), el("option", { value: "semana" }, "Semana"));
  const busca = el("input", { id: "agenda-busca", type: "search", autocomplete: "off",
    placeholder: "Buscar tutor, animal ou telefone" });
  const lista = el("div", { id: "agenda-lista" });
  const painel = el("div", { id: "agenda-painel" });
  const confirmacao = el("div", { id: "agenda-confirmacao", role: "status" });

  let sequencia = 0;  // respostas fora de ordem (busca digitada rápido) não sobrescrevem a atual
  const carregar = async () => {
    const termo = busca.value.trim();
    const minha = ++sequencia;
    let itens;
    try {
      if (termo) {
        itens = await api(`/api/busca?q=${encodeURIComponent(termo)}`);
      } else {
        const base = seletor.value || hojeISO();
        const de = modo.value === "semana" ? inicioDaSemana(base) : base;
        const ate = modo.value === "semana" ? somarDias(de, 6) : base;
        itens = await api(`/api/agenda?de=${de}&ate=${ate}`);
      }
    } catch (_) {
      if (minha !== sequencia) return;
      lista.replaceChildren(el("p", { class: "erro" }, "Não foi possível carregar a agenda."));
      return;
    }
    if (minha !== sequencia) return;
    if (!itens.length) {
      lista.replaceChildren(vazio(termo ? "Nada encontrado." : "Nenhum atendimento no período."));
      return;
    }
    const porDia = new Map();
    for (const it of itens) {
      const dia = it.inicio.slice(0, 10);
      if (!porDia.has(dia)) porDia.set(dia, []);
      porDia.get(dia).push(it);
    }
    lista.replaceChildren(...[...porDia].map(([dia, its]) =>
      el("div", { class: "cartao" }, el("h2", {}, rotuloDia(dia)), ...its.map(linhaAtendimento))));
  };

  const linhaAtendimento = (it) => {
    const acoes = [];
    if (podeAgendar && it.status === "AGENDADO" && !it.pendente) {
      acoes.push(
        el("button", { type: "button", class: "remarcar", onclick: (e) => {
          e.stopPropagation();
          formRemarcar(it);
        } }, "Remarcar"),
        el("button", { type: "button", class: "cancelar", onclick: async (e) => {
          e.stopPropagation();
          await api(`/api/atendimentos/${it.id}/cancelar`, { method: "POST" });
          carregar();
        } }, "Cancelar"));
    }
    const abre = abreAtendimento && it.status !== "CANCELADO";
    const abrir = () => { location.hash = `#/atendimento/${it.id}`; };
    return el("div", {
      class: `atendimento status-${it.status.toLowerCase()}${abre ? " abre" : ""}`,
      "data-id": it.id,
      role: abre ? "link" : null,
      tabindex: abre ? "0" : null,
      onclick: abre ? abrir : null,
      onkeydown: abre ? (e) => { if (e.key === "Enter") abrir(); } : null,
    },
    el("strong", {}, `${it.inicio.slice(11)} · ${it.tipo}`),
    el("span", { class: "etiqueta" }, ROTULO_STATUS[it.status]),
    el("div", {}, `${it.animal} (${it.especie}) · ${it.tutor}`),
    acoes.length ? el("div", { class: "acoes" }, ...acoes) : "");
  };

  // Horários em botões, agrupados por período do dia; os ocupados ficam riscados.
  const desenharHorarios = (container, horarios, escolhidoAtual, aoEscolher) => {
    if (!horarios.length) {
      container.replaceChildren(el("p", {}, "Sem atendimento neste dia."));
      return;
    }
    const grupos = [["Manhã", horarios.filter((h) => h.inicio.slice(11) < "12:00")],
      ["Tarde", horarios.filter((h) => h.inicio.slice(11) >= "12:00")]];
    container.replaceChildren(...grupos.filter(([, hs]) => hs.length).flatMap(([nome, hs]) => [
      el("div", { class: "periodo" }, nome),
      el("div", { class: "slots" }, ...hs.map((h) =>
        el("button", { type: "button", class: "slot", "data-hora": h.inicio.slice(11),
          disabled: h.livre ? null : "",
          "aria-pressed": h.inicio === escolhidoAtual ? "true" : null,
          onclick: (e) => {
            container.querySelectorAll(".slot").forEach((b) => b.removeAttribute("aria-pressed"));
            e.currentTarget.setAttribute("aria-pressed", "true");
            aoEscolher(h.inicio);
          } }, h.inicio.slice(11)))),
    ]));
  };

  // ---------- remarcar ----------

  const formRemarcar = (it) => {
    const erro = el("p", { class: "erro", role: "alert" });
    const slots = el("div", { id: "slots" });
    const data = el("input", { id: "ag-data", type: "date", value: it.inicio.slice(0, 10) });
    let escolhido = null;

    const carregarSlots = async () => {
      escolhido = null;
      const qs = `data=${data.value}${it.duracao_min ? `&duracao_min=${it.duracao_min}` : ""}`;
      let horarios = [];
      try { horarios = await api(`/api/horarios?${qs}`); } catch (_) { /* sem horários */ }
      desenharHorarios(slots, horarios, null, (h) => { escolhido = h; });
    };

    const confirmar = async () => {
      erro.textContent = "";
      if (!escolhido) { erro.textContent = "Escolha um horário."; return; }
      try {
        await api(`/api/atendimentos/${it.id}`, { method: "PATCH",
          body: JSON.stringify({ inicio: escolhido }) });
        painel.replaceChildren();
        seletor.value = escolhido.slice(0, 10);
        carregar();
      } catch (e) {
        const d = e.corpo && e.corpo.detail;
        erro.textContent = (d && d.mensagem) || "Não foi possível remarcar.";
        carregarSlots();
      }
    };

    data.addEventListener("change", carregarSlots);
    painel.replaceChildren(el("div", { class: "cartao" },
      el("h2", {}, "Remarcar atendimento"),
      el("label", { for: "ag-data" }, "Data"), data, slots, erro,
      el("button", { type: "button", class: "primario", id: "ag-confirmar", onclick: confirmar }, "Confirmar"),
      el("button", { type: "button", onclick: () => painel.replaceChildren() }, "Fechar")));
    carregarSlots();
  };

  // ---------- agendar: guiado em três passos (Tutor, Animal, Quando) ----------

  const formAgendamento = async () => {
    const s = { tutor: null, novoTutor: false, cpfBusca: null, animalId: null, novoAnimal: false,
      escolhido: null, tipo: null, tipos: [] };

    const erroDe = (id) => el("p", { class: "campo-erro", id, role: "alert" });
    const eBusca = erroDe("ag-e-tutor"); const eNomeT = erroDe("ag-e-t-nome");
    const eTelT = erroDe("ag-e-t-telefone"); const eAnimal = erroDe("ag-e-animal");
    const eNomeA = erroDe("ag-e-a-nome"); const eEspA = erroDe("ag-e-a-especie");
    const eTipo = erroDe("ag-e-tipo"); const eHora = erroDe("ag-e-horario");
    const eCpf = erroDe("ag-e-cpf");
    const erro = el("p", { class: "erro", role: "alert", id: "ag-erro" });

    const buscaTutor = el("input", { id: "ag-tutor", type: "search", autocomplete: "off",
      placeholder: "CPF, nome ou telefone do tutor" });
    const resultados = el("div", { id: "ag-resultados" });
    const nomeT = el("input", { id: "ag-t-nome", autocomplete: "off" });
    const telT = el("input", { id: "ag-t-telefone", type: "tel", autocomplete: "off" });
    const secaoTutor = el("div", { id: "ag-tutor-dados", hidden: "" },
      el("label", { for: "ag-t-nome" }, "Nome do tutor"), nomeT, eNomeT,
      el("label", { for: "ag-t-telefone" }, "Telefone"), telT, eTelT);

    const animaisDoTutor = el("div", { id: "ag-animais", class: "chips" });
    const nomeA = el("input", { id: "ag-a-nome", autocomplete: "off" });
    const espA = el("input", { id: "ag-a-especie", autocomplete: "off" });
    const especiesRapidas = el("div", { class: "chips" }, ...ESPECIES_COMUNS.map((e) =>
      el("button", { type: "button", class: "chip", "data-especie": e, onclick: () => {
        espA.value = e; eEspA.textContent = ""; atualizar();
      } }, e)));
    const camposAnimal = el("div", { id: "ag-animal-novo", hidden: "" },
      el("label", { for: "ag-a-nome" }, "Nome do animal"), nomeA, eNomeA,
      el("label", { for: "ag-a-especie" }, "Espécie"), especiesRapidas, espA, eEspA);

    const tipos = el("div", { id: "ag-tipos", class: "chips" });
    const data = el("input", { id: "ag-data", type: "date", value: seletor.value || hojeISO() });
    const slots = el("div", { id: "slots" });

    const contato = el("input", { type: "checkbox", id: "ag-contato" });
    const cpfT = el("input", { id: "ag-t-cpf", inputmode: "numeric", autocomplete: "off",
      placeholder: "Somente números (opcional)" });
    const emailT = el("input", { id: "ag-t-email", type: "email", autocomplete: "off" });
    const endT = el("input", { id: "ag-t-endereco", autocomplete: "off" });
    const sexoA = el("select", { id: "ag-a-sexo" }, el("option", { value: "" }, "Indefinido"),
      el("option", { value: "MACHO" }, "Macho"), el("option", { value: "FEMEA" }, "Fêmea"));
    const racaA = el("input", { id: "ag-a-raca", autocomplete: "off" });
    const nascA = el("input", { id: "ag-a-nascimento", type: "date" });
    const pelA = el("input", { id: "ag-a-pelagem", autocomplete: "off" });
    const blocoCpf = el("div", { id: "ag-cpf-bloco", hidden: "" },
      el("label", { for: "ag-t-cpf" }, "CPF do tutor"), cpfT, eCpf);

    const resumo = el("div", { class: "resumo-agendamento", id: "ag-resumo", hidden: "" });
    const barraAcao = el("div", { class: "barra-acao" },
      el("button", { type: "button", class: "primario", id: "ag-confirmar", onclick: () => confirmar() }, "Agendar"),
      el("button", { type: "button", onclick: () => painel.replaceChildren() }, "Fechar"));
    const passoAnimal = el("section", { class: "passo", id: "passo-animal", hidden: "" },
      el("h3", { class: "passo-titulo" }, el("span", { class: "numero" }, "2"), "Animal"),
      animaisDoTutor, camposAnimal, eAnimal);
    const passoQuando = el("section", { class: "passo", id: "passo-quando", hidden: "" },
      el("h3", { class: "passo-titulo" }, el("span", { class: "numero" }, "3"), "Quando"),
      el("label", {}, "Tipo de atendimento"), tipos, eTipo,
      el("label", { for: "ag-data" }, "Dia"),
      el("div", { class: "chips" },
        el("button", { type: "button", class: "chip", onclick: () => { data.value = hojeISO(); carregarSlots(); } }, "Hoje"),
        el("button", { type: "button", class: "chip", onclick: () => { data.value = somarDias(hojeISO(), 1); carregarSlots(); } }, "Amanhã")),
      data, slots, eHora,
      el("label", { class: "consentimento-linha" }, contato,
        "Tutor autoriza contato (lembretes e campanhas)"),
      el("details", { id: "ag-mais" }, el("summary", {}, "Mais dados"),
        blocoCpf,
        el("label", { for: "ag-t-email" }, "E-mail do tutor"), emailT,
        el("label", { for: "ag-t-endereco" }, "Endereço do tutor"), endT,
        el("label", { for: "ag-a-sexo" }, "Sexo do animal"), sexoA,
        el("label", { for: "ag-a-raca" }, "Raça"), racaA,
        el("label", { for: "ag-a-nascimento" }, "Nascimento"), nascA,
        el("label", { for: "ag-a-pelagem" }, "Pelagem"), pelA));

    const animalDefinido = () => (s.animalId && !s.novoAnimal)
      || (s.novoAnimal && nomeA.value.trim() && espA.value.trim());

    // Mostra só o que já faz sentido: cada passo aparece quando o anterior está definido.
    function atualizar() {
      const tutorOk = !!(s.tutor || s.novoTutor);
      passoAnimal.hidden = !tutorOk;
      secaoTutor.hidden = !tutorOk;
      camposAnimal.hidden = !s.novoAnimal;
      passoQuando.hidden = !(tutorOk && animalDefinido());
      // CPF: nunca pedido de novo; só aparece quando ainda não se sabe o CPF do tutor.
      blocoCpf.hidden = !((s.novoTutor && !s.cpfBusca) || (s.tutor && !s.tutor.cpf));
      const pronto = tutorOk && animalDefinido() && s.tipo && s.escolhido;
      resumo.hidden = !pronto;
      barraAcao.classList.toggle("fixa", !!pronto);  // fica à vista só quando já dá para confirmar
      if (pronto) {
        const nomeAnimal = s.novoAnimal || !s.animalId ? nomeA.value.trim()
          : (s.tutor.animais.find((a) => a.id === s.animalId) || {}).nome;
        resumo.textContent = `${nomeAnimal} · ${nomeT.value.trim()} · ${s.tipo.nome} · `
          + `${rotuloDia(s.escolhido.slice(0, 10))} às ${s.escolhido.slice(11)}`;
      }
    }

    const desenharAnimais = () => {
      const existentes = s.tutor ? s.tutor.animais : [];
      if (!existentes.length && !s.animalId && (s.tutor || s.novoTutor)) s.novoAnimal = true;
      animaisDoTutor.replaceChildren(...existentes.map((a) =>
        el("button", { type: "button", class: "chip animal", "data-animal": a.id,
          "aria-pressed": !s.novoAnimal && s.animalId === a.id ? "true" : null,
          onclick: () => { s.animalId = a.id; s.novoAnimal = false; eAnimal.textContent = "";
            desenharAnimais(); } }, `${a.nome} (${a.especie})`)),
      el("button", { type: "button", class: "chip novo-animal",
        "aria-pressed": s.novoAnimal ? "true" : null,
        onclick: () => { s.animalId = null; s.novoAnimal = true; desenharAnimais(); nomeA.focus(); } },
      "+ Novo animal"));
      atualizar();
    };

    const carregarSlots = async () => {
      s.escolhido = null; eHora.textContent = "";
      const qs = `data=${data.value}${s.tipo ? `&duracao_min=${s.tipo.duracao_min}` : ""}`;
      let horarios = [];
      try { horarios = await api(`/api/horarios?${qs}`); } catch (_) { /* sem horários */ }
      desenharHorarios(slots, horarios, null,
        (h) => { s.escolhido = h; eHora.textContent = ""; atualizar(); });
      atualizar();
    };

    const definirTutor = (tutor) => {
      s.tutor = tutor; s.novoTutor = false; s.cpfBusca = null; s.novoAnimal = false;
      s.animalId = tutor.animais.length === 1 ? tutor.animais[0].id : null;
      resultados.replaceChildren(el("div", { class: "aviso", id: "ag-tutor-escolhido" },
        `${tutor.nome} · ${tutor.telefone}`, tutor.cpf ? ` · CPF ${mascararCpf(tutor.cpf)}` : "", " ",
        el("button", { type: "button", class: "trocar", onclick: () => {
          s.tutor = null; s.animalId = null; s.novoAnimal = false; buscaTutor.value = "";
          resultados.replaceChildren(); desenharAnimais(); buscaTutor.focus();
        } }, "Trocar")));
      nomeT.value = tutor.nome || ""; telT.value = tutor.telefone || "";
      cpfT.value = ""; emailT.value = tutor.email || ""; endT.value = tutor.endereco || "";
      contato.checked = tutor.aceita_contato === "SIM";
      desenharAnimais();
    };

    const comecarTutorNovo = (texto) => {
      s.tutor = null; s.novoTutor = true; s.animalId = null; s.novoAnimal = true; s.cpfBusca = null;
      const d = soDigitosUI(texto);
      nomeT.value = ""; telT.value = ""; cpfT.value = ""; emailT.value = ""; endT.value = "";
      contato.checked = false;
      // O que foi digitado na busca já responde: CPF vira o CPF do tutor (sem pedir de novo),
      // número vira telefone e letras viram o nome.
      if (d.length === 11 && RoniVet.cpf.valido(d)) s.cpfBusca = d;
      else if (d.length >= 8) telT.value = texto.trim();
      else if (/\p{L}/u.test(texto)) nomeT.value = texto.trim();
      desenharAnimais();
    };

    let temporizador; let contador = 0;
    buscaTutor.addEventListener("input", () => {
      clearTimeout(temporizador);
      eBusca.textContent = "";
      s.tutor = null; s.novoTutor = false; s.cpfBusca = null; s.animalId = null; s.novoAnimal = false;
      desenharAnimais();
      temporizador = setTimeout(async () => {
        const texto = buscaTutor.value;
        const minha = ++contador;
        const tutores = await procurarTutores(texto);
        if (minha !== contador) return;
        if (!texto.trim()) { resultados.replaceChildren(); return; }
        if (!tutores.length) {
          resultados.replaceChildren(el("p", { id: "ag-sem-tutor", class: "aviso" },
            soDigitosUI(texto).length === 11 && RoniVet.cpf.valido(texto)
              ? "CPF ainda não cadastrado: informe nome e telefone abaixo."
              : "Tutor não encontrado: preencha os dados abaixo."));
          comecarTutorNovo(texto);
          return;
        }
        resultados.replaceChildren(
          ...tutores.map((t) => el("button", { type: "button", class: "resultado-tutor",
            "data-tutor": t.id, onclick: () => definirTutor(t) },
          el("strong", {}, t.nome), ` · ${t.telefone}`,
          t.cpf ? ` · CPF ${mascararCpf(t.cpf)}` : "",
          el("small", {}, t.animais.length
            ? `Animais: ${t.animais.map((a) => a.nome).join(", ")}` : "Sem animais"))),
          el("button", { type: "button", class: "novo-tutor", onclick: () => {
            resultados.replaceChildren(); comecarTutorNovo(texto);
          } }, "Não é nenhum destes: novo tutor"));
      }, 250);
    });
    [[nomeT, eNomeT], [telT, eTelT], [nomeA, eNomeA], [espA, eEspA], [cpfT, eCpf]]
      .forEach(([campo, msg]) => campo.addEventListener("input", () => {
        campo.classList.remove("campo-invalido");
        msg.textContent = "";
        atualizar();
      }));

    const desenharTipos = () => {
      tipos.replaceChildren(...s.tipos.map((tp) =>
        el("button", { type: "button", class: "chip", "data-tipo": tp.id,
          "aria-pressed": s.tipo && s.tipo.id === tp.id ? "true" : null,
          onclick: () => { s.tipo = tp; eTipo.textContent = ""; desenharTipos(); carregarSlots(); } },
        tp.nome)));
    };

    try { s.tipos = await api("/api/tipos"); } catch (_) { s.tipos = []; }
    if (s.tipos.length === 1) s.tipo = s.tipos[0];
    data.addEventListener("change", carregarSlots);

    const mensagemErro = (e) => {
      const d = e.corpo && e.corpo.detail;
      if (d && d.codigo === "campos_faltando") {
        return `Informe: ${d.campos.map((c) => ROTULO_CAMPO[c] || c).join(", ")}.`;
      }
      if (d && d.codigo === "cpf_duplicado") return "Este CPF já pertence a outro tutor cadastrado.";
      if (d && d.codigo === "cpf_invalido") return "CPF inválido.";
      if (d && d.mensagem) return d.mensagem;
      return "Não foi possível agendar.";
    };

    // Validação em linha: a mensagem aparece junto ao campo e o que foi digitado é mantido.
    const validar = () => {
      [eBusca, eNomeT, eTelT, eAnimal, eNomeA, eEspA, eTipo, eHora, eCpf]
        .forEach((n) => { n.textContent = ""; });
      [nomeT, telT, nomeA, espA, buscaTutor, cpfT].forEach((c) => c.classList.remove("campo-invalido"));
      const falhas = [];
      const falha = (campo, alvo, msg) => {
        alvo.textContent = msg;
        if (campo) campo.classList.add("campo-invalido");
        falhas.push(campo || alvo);
      };
      if (!s.tutor && !s.novoTutor) {
        falha(buscaTutor, eBusca, "Informe o tutor (CPF, nome ou telefone).");
      } else {
        if (!nomeT.value.trim()) falha(nomeT, eNomeT, "Informe o nome do tutor.");
        if (!telT.value.trim()) falha(telT, eTelT, "Informe o telefone do tutor.");
        if (s.novoAnimal || !s.animalId) {
          if (!nomeA.value.trim()) falha(nomeA, eNomeA, "Informe o nome do animal.");
          if (!espA.value.trim()) falha(espA, eEspA, "Informe a espécie.");
        }
        const cpfDigitado = soDigitosUI(cpfT.value);
        if (cpfDigitado && !RoniVet.cpf.valido(cpfDigitado)) {
          document.getElementById("ag-mais").open = true;
          falha(cpfT, eCpf, "CPF inválido.");
        }
        if (!s.tipo) falha(null, eTipo, "Escolha o tipo de atendimento.");
        if (!s.escolhido) falha(null, eHora, "Escolha um horário.");
      }
      if (falhas.length) {
        const alvo = falhas[0];
        if (alvo.tagName === "INPUT") alvo.focus();
        else alvo.scrollIntoView({ block: "center" });
      }
      return falhas.length === 0;
    };

    const confirmar = async () => {
      erro.textContent = "";
      if (!validar()) return;
      const cpf = s.cpfBusca || soDigitosUI(cpfT.value);
      const tutor = { nome: nomeT.value.trim(), telefone: telT.value.trim(),
        email: emailT.value.trim(), endereco: endT.value.trim() };
      if (cpf) tutor.cpf = cpf;
      if (s.tutor) {
        tutor.id = s.tutor.id;
        if (contato.checked !== (s.tutor.aceita_contato === "SIM")) tutor.aceita_contato = contato.checked;
      } else {
        tutor.id = novoUuid();
        if (contato.checked) tutor.aceita_contato = true;
      }
      const animal = s.animalId && !s.novoAnimal
        ? { id: s.animalId }
        : { id: novoUuid(), nome: nomeA.value.trim(), especie: espA.value.trim(),
          sexo: sexoA.value || undefined, raca: racaA.value.trim(),
          data_nascimento: nascA.value || undefined, pelagem: pelA.value.trim() };
      const botao = document.getElementById("ag-confirmar");
      botao.disabled = true;
      try {
        const r = await api("/api/agendamentos", { method: "POST", body: JSON.stringify({
          inicio: s.escolhido, id_tipo: s.tipo.id, tutor, animal }) });
        const nomeAnimal = (r.animal && r.animal.nome) || animal.nome;
        const nomeTutor = (r.tutor && r.tutor.nome) || tutor.nome;
        const quando = `${rotuloDia(s.escolhido.slice(0, 10))} às ${s.escolhido.slice(11)}`;
        const linhas = [`Agendado: ${nomeAnimal} (${nomeTutor}) em ${quando}.`];
        if (r.tutor_reutilizado && !s.tutor) linhas.push(`Tutor já cadastrado reutilizado: ${nomeTutor}.`);
        if (r.animal_reutilizado && !s.animalId) linhas.push(`Animal já cadastrado reutilizado: ${nomeAnimal}.`);
        if (r.pendente) linhas.push("Aguardando envio ao servidor.");
        confirmacao.replaceChildren(el("div", { class: "confirmacao", id: "ag-ok" }, logo(),
          el("div", {}, linhas.join(" "))));
        painel.replaceChildren();
        busca.value = "";
        seletor.value = s.escolhido.slice(0, 10);
        carregar();
      } catch (e) {
        botao.disabled = false;
        const d = e.corpo && e.corpo.detail;
        if (d && d.codigo === "conflito_horario") { eHora.textContent = mensagemErro(e); carregarSlots(); }
        else if (d && d.codigo === "cpf_duplicado") { eBusca.textContent = mensagemErro(e); }
        else erro.textContent = mensagemErro(e);
      }
    };

    painel.replaceChildren(el("div", { class: "cartao", id: "ag-form" },
      el("h2", {}, "Novo agendamento"),
      el("section", { class: "passo", id: "passo-tutor" },
        el("h3", { class: "passo-titulo" }, el("span", { class: "numero" }, "1"), "Tutor"),
        el("label", { for: "ag-tutor" }, "CPF, nome ou telefone"), buscaTutor, eBusca,
        resultados, secaoTutor),
      passoAnimal, passoQuando, resumo, erro, barraAcao));
    desenharTipos();
    desenharAnimais();
    carregarSlots();
    buscaTutor.focus();
  };

  [seletor, modo].forEach((c) => c.addEventListener("change", () => { busca.value = ""; carregar(); }));
  let tBusca;
  busca.addEventListener("input", () => { clearTimeout(tBusca); tBusca = setTimeout(carregar, 250); });
  // Depois que a fila offline é enviada, a lista reflete o servidor sem mexer no painel aberto.
  const aoSincronizar = () => {
    if (!lista.isConnected) {
      document.removeEventListener("ronivet:dados-sincronizados", aoSincronizar);
      return;
    }
    carregar();
  };
  document.addEventListener("ronivet:dados-sincronizados", aoSincronizar);
  raiz.append(
    el("div", { class: "cartao barra" }, busca, seletor, modo,
      el("button", { type: "button", onclick: () => { busca.value = ""; seletor.value = hojeISO(); carregar(); } }, "Hoje"),
      podeAgendar ? el("button", { type: "button", class: "primario", id: "novo-agendamento",
        onclick: () => formAgendamento() }, "Agendar") : ""),
    painel, confirmacao, lista);
  carregar();
}
