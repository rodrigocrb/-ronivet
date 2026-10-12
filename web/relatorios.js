"use strict";
// Telas de painel e campanha vacinal.

function telaPainel(raiz) {
  const hoje = hojeISO();
  const de = el("input", { id: "painel-de", type: "date", value: `${hoje.slice(0, 8)}01` });
  const ate = el("input", { id: "painel-ate", type: "date", value: hoje });
  const tipo = el("select", { id: "painel-tipo" }, el("option", { value: "" }, "Todos os tipos"));
  const saida = el("div", { id: "painel-saida" });

  const barra = (rotulo, valor, maximo) => el("div", { class: "barra-grafico" },
    el("span", { class: "rotulo" }, rotulo),
    el("span", { class: "preenchimento", style: `width:${maximo ? Math.round(100 * valor / maximo) : 0}%` }),
    el("span", { class: "valor" }, String(valor)));

  const carregar = async () => {
    const params = new URLSearchParams({ de: de.value, ate: ate.value });
    if (tipo.value) params.set("tipo", tipo.value);
    try {
      const d = await api(`/api/dashboard?${params}`);
      const maxE = Math.max(0, ...d.por_especie.map((x) => x.total));
      const maxS = Math.max(0, ...d.por_sexo.map((x) => x.total));
      const nomeSexo = { MACHO: "Macho", FEMEA: "Fêmea", INDEFINIDO: "Indefinido" };
      saida.replaceChildren(
        el("div", { class: "cartao" }, el("h2", {}, `Atendimentos encerrados: ${d.total}`),
          el("h2", {}, "Por espécie"),
          ...(d.por_especie.length ? d.por_especie.map((x) => barra(x.especie, x.total, maxE))
            : [el("p", {}, "Sem atendimentos no período.")]),
          el("h2", {}, "Por sexo"),
          ...d.por_sexo.map((x) => barra(nomeSexo[x.sexo], x.total, maxS))),
        el("div", { class: "cartao" }, el("h2", {}, "Espécie e sexo"),
          el("table", { class: "tabela" },
            el("tr", {}, el("th", {}, "Espécie"), el("th", {}, "Sexo"), el("th", {}, "Total")),
            ...d.por_especie_sexo.map((x) => el("tr", {}, el("td", {}, x.especie),
              el("td", {}, nomeSexo[x.sexo]), el("td", {}, String(x.total)))))));
    } catch (_) {
      saida.replaceChildren(el("p", { class: "erro" }, "Não foi possível carregar o painel."));
    }
  };
  api("/api/tipos?incluir_inativos=true").then((tipos) =>
    tipos.forEach((t) => tipo.append(el("option", { value: t.id }, t.nome)))).catch(() => {});
  raiz.append(el("div", { class: "cartao barra" }, de, ate, tipo,
    el("button", { type: "button", class: "primario", id: "painel-atualizar", onclick: carregar }, "Atualizar")),
    saida);
  carregar();
}

function telaCampanha(raiz) {
  const dias = el("input", { id: "campanha-dias", type: "number", min: "0", max: "365", value: "30" });
  const lista = el("div", { id: "campanha-lista" });
  const rotuloSituacao = { ATRASADO: "Atrasado", A_VENCER: "A vencer" };

  const carregar = async () => {
    try {
      const itens = await api(`/api/campanha?dias=${encodeURIComponent(dias.value || 30)}`);
      if (!itens.length) { lista.replaceChildren(el("p", {}, "Nenhum animal com reforço no período.")); return; }
      lista.replaceChildren(...itens.map((i) => {
        const [a, m, d] = i.vencimento.split("-");
        const acoes = [];
        if (i.contatar) {
          const tel = i.telefone.replace(/\D/g, "");
          acoes.push(el("a", { href: `tel:${tel}`, class: "botao" }, "Ligar"),
            el("a", { href: `https://wa.me/55${tel}`, target: "_blank", rel: "noopener", class: "botao" }, "WhatsApp"),
            el("button", { type: "button", class: "contatado", onclick: async () => {
              await api("/api/campanha/contatos", { method: "POST", body: JSON.stringify({
                id_animal: i.id_animal, id_vacina: i.id_vacina, resultado: "contatado" }) });
              carregar();
            } }, "Marcar contatado"));
        }
        return el("div", { class: `atendimento situacao-${i.situacao.toLowerCase()}`, "data-animal": i.id_animal },
          el("strong", {}, `${i.animal} (${i.especie}) · ${i.vacina || "Vacina"}`),
          el("span", { class: "etiqueta" }, rotuloSituacao[i.situacao]),
          el("div", {}, `Vence em ${d}/${m}/${a} · última aplicação ${i.ultima_aplicacao}`),
          el("div", {}, `Tutor: ${i.tutor}${i.contatar ? ` · ${i.telefone}` : ""}`),
          i.sem_autorizacao_de_contato
            ? el("div", { class: "aviso" }, "Sem autorização de contato") : "",
          i.ultimo_contato ? el("small", {}, `Último contato: ${i.ultimo_contato}`) : "",
          el("div", { class: "acoes" }, ...acoes));
      }));
    } catch (_) {
      lista.replaceChildren(el("p", { class: "erro" }, "Não foi possível carregar a campanha."));
    }
  };
  raiz.append(el("div", { class: "cartao barra" },
    el("label", { for: "campanha-dias" }, "Vencem em até (dias)"), dias,
    el("button", { type: "button", class: "primario", id: "campanha-atualizar", onclick: carregar }, "Atualizar"),
    el("a", { class: "botao", id: "campanha-exportar",
      href: "/api/campanha/exportar", download: "campanha-vacinal.csv" }, "Exportar CSV")),
    lista);
  dias.addEventListener("change", () => {
    document.getElementById("campanha-exportar").href =
      `/api/campanha/exportar?dias=${encodeURIComponent(dias.value || 30)}`;
  });
  carregar();
}
