"use strict";
// Copia web/ para o projeto Android (npx cap sync). O aplicativo não tem configuração embutida:
// o núcleo de regras roda no aparelho e a conta Google é escolhida na entrada.
const { execSync } = require("node:child_process");

execSync("npx cap sync android", { stdio: "inherit", cwd: __dirname });
console.log("web/ sincronizado com o projeto Android.");
