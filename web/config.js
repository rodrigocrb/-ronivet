"use strict";
// Configuração (administrador): horários de atendimento e tipos de atendimento como
// questionário (perguntas que o veterinário preenche), com o documento e a prévia.

/** `secao`: "horarios" | "tipos" | "pessoas" (itens do menu); sem ela, tudo junto. */
function telaConfig(raiz, secao) {
  const aviso = el("p", { id: "config-aviso", class: "aviso", role: "status" });
  const horarios = el("div", { id: "config-horarios", class: "cartao" });
  const tipos = el("div", { id: "config-tipos" });
  const T = RoniTipos;

  const avisar = (texto) => { aviso.textContent = texto; };

  // ---------- horários ----------

  const desenharHorarios = async () => {
    const dias = await api("/api/config-horarios");
    const linhas = dias.map((d) => {
      const atende = el("input", { type: "checkbox", id: `h-atende-${d.dia_semana}` });
      atende.checked = d.atende === "SIM";
      const inicio = el("input", { type: "time", id: `h-inicio-${d.dia_semana}`, value: d.inicio || "08:00" });
      const fim = el("input", { type: "time", id: `h-fim-${d.dia_semana}`, value: d.fim || "18:00" });
      const dur = el("input", { type: "number", min: "5", step: "5", id: `h-dur-${d.dia_semana}`,
        value: d.duracao_min || 30 });
      return { d, atende, inicio, fim, dur,
        no: el("div", { class: "linha-horario" },
          el("label", {}, atende, ` ${DIAS_SEMANA[d.dia_semana]}`), inicio, fim, dur) };
    });
    horarios.replaceChildren(
      el("h2", {}, "Horários de atendimento"),
      el("p", {}, el("small", {}, "Início · fim · duração de cada horário (min)")),
      ...linhas.map((l) => l.no),
      el("button", { type: "button", class: "primario", id: "salvar-horarios", onclick: async () => {
        const corpo = { dias: linhas.map((l) => ({
          dia_semana: l.d.dia_semana,
          atende: l.atende.checked ? "SIM" : "NAO",
          inicio: l.atende.checked ? l.inicio.value : null,
          fim: l.atende.checked ? l.fim.value : null,
          duracao_min: l.atende.checked ? Number(l.dur.value) : null })) };
        try {
          await api("/api/config-horarios", { method: "PUT", body: JSON.stringify(corpo) });
          avisar("Horários salvos.");
        } catch (_) {
          avisar("Não foi possível salvar. Confira início, fim e duração.");
        }
      } }, "Salvar horários"));
  };

  // ---------- tipos de atendimento: lista ----------

  const carregarTipos = () => api("/api/tipos?incluir_inativos=true");

  const desenharLista = async () => {
    const lista = await carregarTipos();
    const nome = el("input", { id: "tipo-nome", placeholder: "Nome do tipo (ex.: Consulta)" });
    const dur = el("input", { id: "tipo-duracao", type: "number", min: "5", step: "5", value: "30" });
    tipos.replaceChildren(el("div", { class: "cartao" },
      el("h2", {}, "Tipos de atendimento"),
      ...(lista.length ? lista.map((t) => el("div", { class: "tipo-linha", "data-tipo": t.id },
        el("span", { class: "tipo-nome" }, t.nome,
          t.ativo === "NAO" ? el("span", { class: "etiqueta" }, "Inativo") : ""),
        el("small", {}, `${t.campos.length} pergunta(s) · ${t.duracao_min} min`),
        el("button", { type: "button", class: "editar-tipo", onclick: () => desenharEditor(t.id) },
          "Editar"))) : [vazio("Nenhum tipo cadastrado.")]),
      el("h3", {}, "Novo tipo"),
      el("label", { for: "tipo-nome" }, "Nome"), nome,
      el("label", { for: "tipo-duracao" }, "Duração (min)"), dur,
      el("button", { type: "button", class: "primario", id: "criar-tipo", onclick: async () => {
        try {
          const novo = await api("/api/tipos", { method: "POST",
            body: JSON.stringify({ nome: nome.value, duracao_min: Number(dur.value) }) });
          desenharEditor(novo.id);
        } catch (_) { avisar("Informe o nome do tipo."); }
      } }, "Criar tipo e configurar perguntas")));
  };

  // ---------- tipos de atendimento: editor (Dados, Perguntas, Documento, Prévia) ----------

  const desenharEditor = async (idTipo) => {
    const lista = await carregarTipos();
    const t = lista.find((x) => x.id === idTipo);
    if (!t) { desenharLista(); return; }
    const campos = t.campos.slice().sort((a, b) => a.ordem - b.ordem);
    const recarregar = () => desenharEditor(idTipo);
    const falhou = () => avisar("Não foi possível salvar. Tente novamente.");

    // Dados
    const nome = el("input", { id: "tipo-edit-nome", value: t.nome });
    const dur = el("input", { id: "tipo-edit-duracao", type: "number", min: "5", step: "5", value: t.duracao_min });
    const ativo = el("input", { type: "checkbox", id: "tipo-edit-ativo" });
    ativo.checked = t.ativo === "SIM";
    const dados = el("section", { class: "bloco", id: "bloco-dados" },
      el("h3", {}, "1 · Dados"),
      el("label", { for: "tipo-edit-nome" }, "Nome do tipo"), nome,
      el("label", { for: "tipo-edit-duracao" }, "Duração de cada horário (min)"), dur,
      el("label", { class: "interruptor", for: "tipo-edit-ativo" }, ativo, " Disponível para agendar"),
      el("button", { type: "button", class: "primario", id: "salvar-dados-tipo", onclick: async () => {
        try {
          await api(`/api/tipos/${t.id}`, { method: "PATCH", body: JSON.stringify({
            nome: nome.value, duracao_min: Number(dur.value), ativo: ativo.checked ? "SIM" : "NAO" }) });
          avisar("Dados do tipo salvos.");
          recarregar();
        } catch (_) { falhou(); }
      } }, "Salvar dados"));

    // Perguntas
    const mover = async (indice, delta) => {
      const novas = T.novasOrdens(T.mover(campos, indice, delta));
      try {
        for (const n of novas) {
          await api(`/api/campos/${n.id}`, { method: "PATCH", body: JSON.stringify({ ordem: n.ordem }) });
        }
        recarregar();
      } catch (_) { falhou(); }
    };

    const linhaPergunta = (c, i) => {
      const rotulo = el("input", { class: "pergunta-rotulo", value: c.rotulo, "aria-label": "Pergunta" });
      rotulo.addEventListener("change", async () => {
        if (!rotulo.value.trim()) { rotulo.value = c.rotulo; return; }
        try {
          await api(`/api/campos/${c.id}`, { method: "PATCH", body: JSON.stringify({ rotulo: rotulo.value }) });
          avisar("Pergunta atualizada.");
        } catch (_) { falhou(); }
      });
      const obrig = el("input", { type: "checkbox", class: "campo-obrigatorio" });
      obrig.checked = c.obrigatorio;
      obrig.addEventListener("change", async () => {
        try {
          await api(`/api/campos/${c.id}`, { method: "PATCH", body: JSON.stringify({ obrigatorio: obrig.checked }) });
        } catch (_) { falhou(); obrig.checked = !obrig.checked; }
      });
      const meta = [el("span", { class: "tipo-resposta" }, T.ROTULO_RESPOSTA[c.tipo_dado] || c.tipo_dado),
        el("label", { class: "interruptor" }, obrig, " Obrigatória")];
      if (c.tipo_dado === "LISTA") {
        const opcoes = el("input", { class: "campo-opcoes", value: c.opcoes.join(", "),
          "aria-label": "Opções (separe por vírgula)", placeholder: "Opções separadas por vírgula" });
        opcoes.addEventListener("change", async () => {
          const itens = T.listarOpcoes(opcoes.value);
          if (!itens.length) { opcoes.value = c.opcoes.join(", "); return; }
          try {
            await api(`/api/campos/${c.id}`, { method: "PATCH", body: JSON.stringify({ opcoes: itens }) });
            opcoes.value = itens.join(", ");
            avisar("Opções atualizadas.");
          } catch (_) { falhou(); }
        });
        meta.push(opcoes);
      }
      const remover = c.papel
        ? el("small", {}, "Usada no registro de vacina")
        : el("button", { type: "button", class: "remover-pergunta", onclick: async () => {
          try {
            await api(`/api/campos/${c.id}`, { method: "PATCH", body: JSON.stringify({ ativo: "NAO" }) });
            recarregar();
          } catch (_) { falhou(); }
        } }, "Remover");
      return el("div", { class: "pergunta", "data-campo": c.nome },
        el("div", { class: "pergunta-topo" },
          el("button", { type: "button", class: "subir", "aria-label": "Mover para cima",
            disabled: i === 0 ? "" : null, onclick: () => mover(i, -1) }, "↑"),
          el("button", { type: "button", class: "descer", "aria-label": "Mover para baixo",
            disabled: i === campos.length - 1 ? "" : null, onclick: () => mover(i, 1) }, "↓"),
          rotulo),
        el("div", { class: "pergunta-meta" }, ...meta, remover));
    };

    const novoRotulo = el("input", { id: "nova-pergunta-rotulo", placeholder: "Ex.: Peso do animal (kg)" });
    const novoTipo = el("select", { id: "nova-pergunta-tipo" },
      ...Object.entries(T.ROTULO_RESPOSTA).map(([v, r]) => el("option", { value: v }, r)));
    const novasOpcoes = el("input", { id: "nova-pergunta-opcoes", hidden: "",
      placeholder: "Opções separadas por vírgula (ex.: Sim, Não, Talvez)" });
    const novoObrig = el("input", { type: "checkbox", id: "nova-pergunta-obrigatoria" });
    novoTipo.addEventListener("change", () => { novasOpcoes.hidden = novoTipo.value !== "LISTA"; });
    const adicionar = async () => {
      const rotulo = novoRotulo.value.trim();
      if (!rotulo) { avisar("Escreva a pergunta."); novoRotulo.focus(); return; }
      const opcoes = T.listarOpcoes(novasOpcoes.value);
      if (novoTipo.value === "LISTA" && opcoes.length < 2) {
        avisar("Informe pelo menos duas opções."); novasOpcoes.hidden = false; novasOpcoes.focus(); return;
      }
      const usados = campos.map((c) => c.nome);
      for (let tentativa = 0; tentativa < 6; tentativa += 1) {
        const nomeCampo = T.nomeTecnico(rotulo, usados);
        try {
          await api(`/api/tipos/${t.id}/campos`, { method: "POST", body: JSON.stringify({
            nome: nomeCampo, rotulo, tipo_dado: novoTipo.value,
            opcoes: novoTipo.value === "LISTA" ? opcoes : null, obrigatorio: novoObrig.checked }) });
          recarregar();
          return;
        } catch (e) {
          if (e.status !== 409) { falhou(); return; }
          usados.push(nomeCampo);  // nome já existe (talvez numa pergunta removida): tenta o próximo
        }
      }
      falhou();
    };
    const perguntas = el("section", { class: "bloco", id: "bloco-perguntas" },
      el("h3", {}, "2 · Perguntas do atendimento"),
      el("p", {}, el("small", {}, "É o que o veterinário preenche ao atender, na ordem abaixo.")),
      ...(campos.length ? campos.map(linhaPergunta) : [vazio("Ainda não há perguntas.")]),
      el("h3", {}, "Nova pergunta"),
      el("label", { for: "nova-pergunta-rotulo" }, "Pergunta"), novoRotulo,
      el("label", { for: "nova-pergunta-tipo" }, "Tipo de resposta"), novoTipo, novasOpcoes,
      el("label", { class: "interruptor", for: "nova-pergunta-obrigatoria" }, novoObrig, " Obrigatória"),
      el("button", { type: "button", class: "primario", id: "adicionar-pergunta", onclick: adicionar },
        "Adicionar pergunta"));

    // Documento
    const statusTemplate = el("p", { class: "template-status", role: "status" },
      t.arquivo_template ? "Documento configurado." : "Sem documento: o sistema gera um padrão.");
    const copiar = async (texto, botao) => {
      try { await navigator.clipboard.writeText(texto); botao.textContent = "Copiado!"; }
      catch (_) { botao.textContent = "Selecione e copie"; }
      setTimeout(() => { botao.textContent = texto; }, 1200);
    };
    const marcadores = [...T.MARCADORES_RESERVADOS, ...campos.map((c) => c.nome)];
    // Modo local: o modelo é um texto com marcadores, guardado junto do tipo (e replicado).
    const TIPO_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    // O modelo é editado no computador: o aplicativo só deixa o .docx inicial no Drive da clínica.
    const baixarModeloInicial = async () => {
      let bytes;
      try {
        const texto = window.RoniVet.documentos.textoModeloPadrao(t.nome,
          campos.map((c) => ({ rotulo: c.rotulo, nome: c.nome })));
        bytes = await window.RoniDocx.gerarDocxInicial(texto.split("\n"));
      } catch (_) {
        statusTemplate.className = "template-status erro";
        statusTemplate.textContent = "Não foi possível gerar o modelo inicial neste aparelho.";
        return;
      }
      const nomeArq = `modelo-${t.nome}.docx`.replace(/[\/:*?"<>|]+/g, " ");
      let salvo = false;
      try { salvo = await syncApp.salvarModeloInicial(nomeArq, bytes); } catch (_) { /* sem conexão */ }
      statusTemplate.className = "template-status" + (salvo ? "" : " erro");
      statusTemplate.textContent = salvo
        ? `Modelo inicial salvo no Drive da clínica em RoniVet/modelos-iniciais/${nomeArq}. Abra-o no `
          + "computador, edite (logo, marca d'água, texto) mantendo os {marcadores} e envie de volta "
          + "em \"Enviar modelo\"."
        : "Não foi possível salvar o modelo no Drive agora. Conecte a conta Google e tente de novo.";
    };
    const enviarModelo = async (arquivoInput) => {
      const arq = arquivoInput.files && arquivoInput.files[0];
      if (!arq) return;
      try {
        const bytes = new Uint8Array(await arq.arrayBuffer());
        const g = await syncApp.guardarModelo(bytes);
        const r = await api(`/api/tipos/${t.id}/modelo`, { method: "PUT",
          body: JSON.stringify({ modelo: g.referencia }) });
        t.arquivo_template = g.referencia;
        statusTemplate.className = "template-status";
        statusTemplate.textContent = `Modelo enviado. Marcadores usados: ${r.marcadores.join(", ") || "nenhum"}.`
          + (g.noDrive ? "" : " Será enviado ao Drive quando houver conexão.");
      } catch (e) {
        const d = (e.corpo && e.corpo.detail) || {};
        statusTemplate.className = "template-status erro";
        statusTemplate.textContent = d.marcadores
          ? `Estes marcadores não existem para este tipo: ${d.marcadores.map((m) => `{${m}}`).join(", ")}.`
          : (/zip|docx/.test(e.message || "") ? "O arquivo não é um documento do Word (.docx)."
            : (d.mensagem || "Não foi possível enviar o modelo."));
      }
    };
    const blocoModeloTexto = () => {
      const atual = (t.arquivo_template || "").startsWith("texto:")
        ? t.arquivo_template.slice("texto:".length) : "";
      const area = el("textarea", { id: "modelo-texto", rows: "10",
        placeholder: "Escreva o documento. Use os marcadores entre chaves, ex.: {animal_nome}." });
      area.value = atual;
      return el("section", { class: "bloco", id: "bloco-documento" },
        el("h3", {}, "3 · Documento"),
        el("p", {}, el("small", {}, "Escreva o texto do documento e use, onde quiser a informação, "
          + "o marcador entre chaves. Toque para copiar. A primeira linha é o título.")),
        el("div", { class: "marcadores" }, ...marcadores.map((m) =>
          el("button", { type: "button", class: "marcador",
            onclick: (e) => copiar(`{${m}}`, e.currentTarget) }, `{${m}}`))),
        el("h4", {}, "Modelo feito pela clínica (Word ou Google Docs)"),
        el("p", {}, el("small", {}, (t.arquivo_template || "").startsWith("docx:")
          ? "Modelo .docx em uso. O PDF é gerado pelo Google Drive depois do encerramento."
          : "Salve o modelo inicial no Drive, edite no computador (logo, marca d'água, tabelas) e envie de volta.")),
        el("div", { class: "acoes" },
          el("button", { type: "button", id: "baixar-modelo-inicial", onclick: baixarModeloInicial },
            "Salvar modelo inicial no Drive"),
          el("label", { class: "botao", for: "enviar-modelo-docx" }, "Enviar modelo (.docx)"),
          el("input", { type: "file", id: "enviar-modelo-docx", accept: ".docx", hidden: "",
            onchange: (ev) => enviarModelo(ev.currentTarget) })),
        el("h4", {}, "Ou modelo simples em texto"),
        area,
        el("button", { type: "button", id: "salvar-modelo", class: "primario", onclick: async () => {
          const texto = area.value.trim();
          try {
            const r = await api(`/api/tipos/${t.id}/modelo`, { method: "PUT",
              body: JSON.stringify({ modelo: texto ? `texto:${texto}` : null }) });
            statusTemplate.className = "template-status";
            statusTemplate.textContent = texto
              ? `Modelo salvo. Marcadores usados: ${r.marcadores.join(", ") || "nenhum"}.`
              : "Modelo removido: será usado o documento padrão.";
          } catch (e) {
            const d = (e.corpo && e.corpo.detail) || {};
            statusTemplate.className = "template-status erro";
            statusTemplate.textContent = d.marcadores
              ? `Estes marcadores não existem: ${d.marcadores.map((m) => `{${m}}`).join(", ")}.`
              : (d.mensagem || "Não foi possível salvar o modelo.");
          }
        } }, "Salvar modelo"),
        statusTemplate);
    };
    const documento = blocoModeloTexto();

    // Prévia somente leitura do que o veterinário verá
    const previa = el("div", { id: "previa-tipo", class: "previa", hidden: "" });
    const verPrevia = el("section", { class: "bloco", id: "bloco-previa" },
      el("h3", {}, "4 · Prévia"),
      el("button", { type: "button", id: "ver-previa", onclick: () => {
        previa.replaceChildren(el("strong", {}, t.nome),
          ...(campos.length ? campos.flatMap((c) => {
            const controle = controleDoCampo(c, "", true);
            return [el("label", { for: controle.id }, c.rotulo + (c.obrigatorio ? " *" : "")), controle];
          }) : [vazio("Sem perguntas.")]));
        previa.hidden = !previa.hidden;
      } }, "Ver como o veterinário verá"),
      previa);

    tipos.replaceChildren(el("div", { class: "cartao" },
      el("button", { type: "button", id: "voltar-tipos", onclick: desenharLista }, "← Voltar aos tipos"),
      el("h2", {}, t.nome), dados, perguntas, documento, verPrevia));
  };

  // ---------- pessoas: cadastro, perfil e convite (compartilhamento da pasta) ----------

  const acesso = el("div", { id: "config-acesso" });
  const ROTULO_PERFIL = { SECRETARIA: "Secretária", VETERINARIO: "Veterinário(a)", ADMIN: "Administrador(a)" };

  // O perfil organiza as telas e a auditoria; não impede o acesso aos dados de quem tem o
  // aparelho desbloqueado ou a pasta compartilhada.
  const desenharPessoas = async () => {
    let usuarios;
    try {
      usuarios = await api("/api/usuarios");
    } catch (_) {
      acesso.replaceChildren();
      return;
    }
    const nome = el("input", { id: "pessoa-nome", placeholder: "Nome da pessoa" });
    const email = el("input", { id: "pessoa-email", type: "email", placeholder: "E-mail (identifica a pessoa)" });
    const perfil = el("select", { id: "pessoa-perfil" },
      ...Object.entries(ROTULO_PERFIL).map(([v, r]) => el("option", { value: v }, r)));
    const crmv = el("input", { id: "pessoa-crmv", placeholder: "CRMV (ex.: CRMV-SP 12345)" });
    const campoCrmv = el("div", { hidden: "" }, el("label", { for: "pessoa-crmv" }, "CRMV"), crmv);
    perfil.addEventListener("change", () => { campoCrmv.hidden = perfil.value === "SECRETARIA"; });
    const erro = el("p", { id: "pessoa-erro", class: "erro", role: "alert" });
    // Convite = compartilhar a pasta da clínica no Drive com o e-mail da pessoa (o Google envia
    // o aviso). Sem conexão ou sem permissão, a pessoa pode ser cadastrada e convidada depois.
    const contaGoogle = (e) => String(e).toLowerCase().replace(/^vet\+/, "");
    let acessos = null;   // e-mails com acesso à pasta; null = não foi possível consultar
    if (syncApp && syncApp.conectado()) {
      try { acessos = new Set((await syncApp.compartilhamentos()).map((p) => p.email)); } catch (_) { /* offline */ }
    }
    const convidar = async (e) => {
      try {
        const r = await syncApp.compartilharPasta(contaGoogle(e));
        avisar(r.jaTinha ? "Esta conta já tem acesso à pasta."
          : `Convite enviado para ${contaGoogle(e)}: a pasta da clínica foi compartilhada.`);
      } catch (x) {
        avisar("Não foi possível compartilhar a pasta agora. Use \"Convidar\" quando houver conexão.");
      }
    };
    const linhas = usuarios.map((u) => {
      const sel = el("select", { class: "usuario-perfil", "aria-label": `Perfil de ${u.nome}` },
        ...Object.entries(ROTULO_PERFIL).map(([v, r]) => el("option", { value: v }, r)));
      sel.value = u.perfil;
      const alterar = async (mudanca) => {
        try {
          await api(`/api/usuarios/${encodeURIComponent(u.email)}`, { method: "PATCH",
            body: JSON.stringify(mudanca) });
          desenharPessoas();
        } catch (e) {
          const d = (e.corpo && e.corpo.detail) || {};
          avisar(d.mensagem || "Não foi possível alterar a pessoa.");
        }
      };
      sel.addEventListener("change", () => alterar({ perfil: sel.value }));
      return el("div", { class: "tipo-linha", "data-usuario": u.email },
        el("span", {}, `${u.nome} · ${u.email} `,
          u.ativo === "NAO" ? el("span", { class: "etiqueta" }, "Desativada") : "",
          acessos && u.ativo === "SIM" && !acessos.has(contaGoogle(u.email))
            ? el("span", { class: "etiqueta" }, "Sem acesso à pasta") : ""),
        sel,
        acessos && u.ativo === "SIM" && !acessos.has(contaGoogle(u.email))
          ? el("button", { type: "button", class: "convidar-usuario", onclick: async () => {
            await convidar(u.email); desenharPessoas(); } }, "Convidar") : "",
        el("button", { type: "button", class: "alternar-usuario", onclick: async () => {
          const desativando = u.ativo === "SIM";
          await alterar({ ativo: desativando ? "NAO" : "SIM" });
          if (!syncApp || !syncApp.conectado()) return;
          try {   // revogação/convite do acesso à pasta acompanha o cadastro
            if (desativando) await syncApp.retirarAcesso(contaGoogle(u.email));
            else await convidar(u.email);
          } catch (_) { avisar("Cadastro alterado, mas o acesso à pasta no Drive não foi atualizado."); }
        } },
        u.ativo === "SIM" ? "Desativar" : "Reativar"));
    });
    acesso.replaceChildren(el("div", { class: "cartao" },
      el("h2", {}, "Pessoas"),
      el("p", { class: "aviso", id: "aviso-perfis" },
        "Os perfis organizam as telas e o registro de quem fez cada coisa. Eles não impedem o "
        + "acesso aos dados: quem usa um aparelho da clínica pode abrir tudo. Mantenha o bloqueio "
        + "de tela ligado. Ao cadastrar uma pessoa, a pasta da clínica é compartilhada com a "
        + "conta Google dela; ao desativar, o acesso é retirado."),
      el("div", { id: "lista-usuarios" }, ...linhas),
      el("h3", {}, "Adicionar pessoa"),
      el("label", { for: "pessoa-nome" }, "Nome"), nome,
      el("label", { for: "pessoa-email" }, "E-mail (a conta Google da pessoa)"), email,
      el("label", { for: "pessoa-perfil" }, "Perfil"), perfil, campoCrmv, erro,
      el("button", { type: "button", class: "primario", id: "adicionar-pessoa", onclick: async () => {
        erro.textContent = "";
        try {
          await api("/api/usuarios", { method: "POST", body: JSON.stringify({
            nome: nome.value, email: email.value, perfil: perfil.value, crmv: crmv.value || null }) });
          if (syncApp && syncApp.conectado()) await convidar(email.value);
          else avisar("Pessoa cadastrada. Conecte a conta Google para convidá-la (compartilhar a pasta).");
          desenharPessoas();
        } catch (e) {
          const d = (e.corpo && e.corpo.detail) || {};
          erro.textContent = d.mensagem || "Não foi possível adicionar. Confira os campos.";
        }
      } }, "Adicionar")));
  };

  const quer = (s) => !secao || secao === s;
  raiz.append(aviso);
  if (quer("horarios")) { raiz.append(horarios); desenharHorarios(); }
  if (quer("tipos")) { raiz.append(tipos); desenharLista(); }
  if (quer("pessoas")) { raiz.append(acesso); desenharPessoas(); }
}
