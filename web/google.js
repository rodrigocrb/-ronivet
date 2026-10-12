"use strict";
// Autorização do Google no aplicativo Android (Capacitor), pelo plugin nativo RoniDriveAuth
// (API de Autorização do Google Play Services). Cada pessoa autoriza com a própria conta Google.
// No navegador (desenvolvimento) não há plugin e a conexão com o Drive fica indisponível.
(function (raiz) {
  const cap = raiz.Capacitor;
  const nativo = !!(cap && cap.isNativePlatform && cap.isNativePlatform());

  // Acesso ao Drive da pessoa: necessário para enxergar a pasta que a clínica compartilha com ela
  // (o acesso restrito aos arquivos do próprio app não vê arquivos de outras contas). O código só
  // usa a pasta RoniVet; ver PRIVACIDADE.md.
  const ESCOPOS_DRIVE = ["https://www.googleapis.com/auth/drive", "email"];

  /**
   * Autoriza o Drive com a conta escolhida no seletor do Android (ou `conta`, em silêncio, se já
   * houver concessão). Devolve { accessToken, email }. Erro com `code`: "10"/"8" = pacote ou
   * SHA-1 não cadastrados no Google Cloud, "negado" = o usuário recusou.
   */
  async function autorizarDrive(conta) {
    const p = ((cap && cap.Plugins) || {}).RoniDriveAuth;
    if (!nativo || !p) throw new Error("autorização do Drive indisponível neste aparelho");
    const r = await p.autorizar({ escopos: ESCOPOS_DRIVE, conta: conta || undefined });
    let email = r.email || null;
    if (!email) {   // a API de autorização nem sempre devolve o e-mail: pergunta ao Google
      try {
        const u = await fetch("https://www.googleapis.com/oauth2/v3/userinfo",
          { headers: { Authorization: `Bearer ${r.accessToken}` } });
        email = ((await u.json()).email || "").toLowerCase() || null;
      } catch (_) { /* segue sem o e-mail */ }
    }
    return { accessToken: r.accessToken, email: email || conta || null };
  }

  raiz.RoniGoogle = { nativo, autorizarDrive };
})(typeof window !== "undefined" ? window : globalThis);
