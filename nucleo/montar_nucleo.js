"use strict";
// Gera web/nucleo.js: os módulos de domínio e o roteador de src/ em um único arquivo para rodar
// dentro do aplicativo.
// Uso: node montar_nucleo.js [--verificar]   (--verificar só confere se o arquivo está em dia)
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "src");
const SAIDA = path.join(__dirname, "..", "web", "nucleo.js");
function modulos() {
  return fs.readdirSync(SRC)
    .filter((f) => /^[0-7]\d_.*\.js$/.test(f))
    .sort();
}

function montar() {
  const partes = ["/* GERADO por nucleo/montar_nucleo.js a partir de nucleo/src. "
    + "Não edite. */\n"];
  for (const f of modulos()) {
    partes.push(`\n/* ---- ${f} ---- */\n`, fs.readFileSync(path.join(SRC, f), "utf8"), "\n");
  }
  return partes.join("");
}

if (require.main === module) {
  const texto = montar();
  if (process.argv.includes("--verificar")) {
    const atual = fs.existsSync(SAIDA) ? fs.readFileSync(SAIDA, "utf8") : "";
    if (atual !== texto) { console.error("web/nucleo.js desatualizado: rode node montar_nucleo.js"); process.exit(1); }
    console.log("web/nucleo.js em dia");
  } else {
    fs.writeFileSync(SAIDA, texto, "utf8");
    console.log(`web/nucleo.js gerado (${modulos().length} módulos, ${texto.length} bytes)`);
  }
}

module.exports = { montar, modulos };
