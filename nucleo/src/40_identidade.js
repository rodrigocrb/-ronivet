/* Identidade, perfis e auditoria. */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};

(function (R) {
  "use strict";

  const ESCREVEM = ["SECRETARIA", "ADMIN"];
  const EDITAM_ANIMAL = ["SECRETARIA", "ADMIN", "VETERINARIO"];
  const CLINICOS = ["VETERINARIO", "ADMIN"];

  R.GRUPOS = { ESCREVEM, EDITAM_ANIMAL, CLINICOS };

  /** Dados do usuário que o aplicativo pode ver. */
  R.usuarioPublico = (u) => ({ email: u.email, nome: u.nome, perfil: u.perfil, crmv: u.crmv });

  /**
   * Valida a credencial e devolve o e-mail (minúsculas) ou lança 401. No aparelho a credencial é
   * "fake:<email>", escolhida na entrada do aplicativo; só vale com `config.permitirLoginTeste`.
   */
  R.verificarCredencial = function verificarCredencial(config, credencial) {
    if (!credencial || typeof credencial !== "string") throw R.erro(401, "não autenticado");
    if (config.permitirLoginTeste && credencial.startsWith("fake:")) {
      const email = credencial.slice(5).trim().toLowerCase();
      if (!email.includes("@")) throw R.erro(401, "credencial inválida");
      return email;
    }
    throw R.erro(401, "credencial inválida");
  };

  /** Usuário ativo cadastrado para o e-mail, ou null. */
  R.usuarioAtivo = (repo, email) => repo.ler("Usuario")
    .find((u) => u.email === email && u.ativo === "SIM") || null;

  /** Registra na trilha (somente inserção) dentro da unidade de trabalho. */
  R.auditar = function auditar(ctx, acao, entidade, idEntidade, campo, anterior, novo) {
    const texto = (v) => (v === null || v === undefined ? null : String(v));
    ctx.tx.inserir("Auditoria", {
      id_auditoria: ctx.amb.novoId(),
      data_hora: ctx.amb.agora(),
      usuario_email: (ctx.usuario && ctx.usuario.email) || ctx.email,
      acao,
      entidade,
      id_entidade: texto(idEntidade),
      campo: texto(campo),
      valor_anterior: texto(anterior),
      valor_novo: texto(novo),
      aparelho: ctx.amb.aparelho ? ctx.amb.aparelho() : null,   // só no aparelho (modo local)
    });
  };
})(RoniVet);
