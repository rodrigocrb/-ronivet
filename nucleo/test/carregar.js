"use strict";
// Carrega src/*.js em um único contexto, em ordem alfabética, como em web/nucleo.js
// (escopo global compartilhado). Cada chamada devolve um RoniVet isolado.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = path.join(__dirname, "..", "src");

function carregar() {
  const contexto = vm.createContext({ console });
  const arquivos = fs.readdirSync(SRC).filter((f) => f.endsWith(".js")).sort();
  for (const arquivo of arquivos) {
    vm.runInContext(fs.readFileSync(path.join(SRC, arquivo), "utf8"), contexto,
      { filename: arquivo });
  }
  return contexto.RoniVet;
}

module.exports = { carregar };
