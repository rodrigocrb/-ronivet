"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { abrirRaiz } = require("../web/raiz");

/** Pastas em memória; `defasagem` faz as listagens não enxergarem pastas criadas por outros. */
function criarFake() {
  let n = 0;
  const pastas = new Map();   // id -> { nome, criadaEm, filhos: Map(id -> {nome, ehPasta}) }
  let relogio = 0;
  const visaoPor = new Map();
  const fake = {
    pastas,
    avancar: () => { relogio += 1; },
    cliente(dono) {
      visaoPor.set(dono, new Set());
      const vistas = visaoPor.get(dono);
      return {
        async listarPastas(nome) {
          return [...pastas.entries()]
            .filter(([id, p]) => p.nome === nome && (vistas.has(id) || !fake.defasagem))
            .map(([id, p]) => ({ id, criadaEm: p.criadaEm }));
        },
        async criarPasta(nome) {
          n += 1;
          const id = `pasta-${n}`;
          pastas.set(id, { nome, criadaEm: relogio, filhos: new Map() });
          vistas.add(id);
          return { id, criadaEm: relogio };
        },
        async listarFilhos(id) {
          return [...pastas.get(id).filhos.entries()].map(([i, f]) => ({ id: i, ...f }));
        },
        async mover(item, de, para) {
          const f = pastas.get(de).filhos.get(item);
          pastas.get(de).filhos.delete(item);
          pastas.get(para).filhos.set(item, f);
        },
        async excluirPasta(id) { pastas.delete(id); },
        revelar() { for (const id of pastas.keys()) vistas.add(id); },
      };
    },
  };
  return fake;
}

test("primeiro aparelho cria a pasta; o segundo usa a mesma", async () => {
  const f = criarFake();
  const a = f.cliente("A");
  const b = f.cliente("B");
  const ra = await abrirRaiz({ api: a });
  assert.equal(ra.criada, true);
  b.revelar();
  const rb = await abrirRaiz({ api: b });
  assert.equal(rb.criada, false);
  assert.equal(rb.id, ra.id);
  assert.equal(f.pastas.size, 1);
});

test("sem pasta e sem permissão de criar: nada é criado", async () => {
  const f = criarFake();
  assert.equal(await abrirRaiz({ api: f.cliente("A"), criar: false }), null);
  assert.equal(f.pastas.size, 0);
});

test("dois aparelhos criam ao mesmo tempo: reconcilia para uma só, sem perder arquivos", async () => {
  const f = criarFake();
  f.defasagem = true;                  // um não enxerga a criação do outro
  const a = f.cliente("A");
  const b = f.cliente("B");
  const ra = await abrirRaiz({ api: a });
  f.avancar();
  const rb = await abrirRaiz({ api: b });
  assert.equal(f.pastas.size, 2, "duas pastas criadas em paralelo");
  // cada aparelho já guardou um arquivo na sua pasta
  f.pastas.get(ra.id).filhos.set("arq-a", { nome: "lote-A", ehPasta: false });
  f.pastas.get(rb.id).filhos.set("arq-b", { nome: "lote-B", ehPasta: false });

  f.defasagem = false;                 // a listagem se atualiza
  const a2 = await abrirRaiz({ api: a });
  const b2 = await abrirRaiz({ api: b });
  assert.equal(f.pastas.size, 1);
  assert.equal(a2.id, b2.id);
  assert.equal(a2.id, ra.id, "vence a mais antiga");
  const nomes = [...f.pastas.get(a2.id).filhos.values()].map((x) => x.nome).sort();
  assert.equal(JSON.stringify(nomes), JSON.stringify(["lote-A", "lote-B"]));
  assert.equal(a2.reconciliada || b2.reconciliada, true);
});
