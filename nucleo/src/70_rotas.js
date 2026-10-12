/* Roteador: autenticação, perfis e despacho (design 1).
 *
 * `criarApi({ repo, amb, config })` devolve:
 *   tratar(envelope)  -> { status, corpo }
 *
 * amb:    { agora(), novoId(), sha256(conteudo), paraBase64(conteudo), documentos }
 * config: { permitirLoginTeste }  ("fake:<email>" é a credencial usada pelo aparelho) */
var RoniVet = (typeof RoniVet !== "undefined") ? RoniVet : {};
RoniVet.ROTAS = RoniVet.ROTAS || [];

(function (R) {
  "use strict";

  const V = R.validar;
  const PUBLICA = "publica";
  const CONTA = "conta";

  // ---------- rotas do próprio roteador ----------

  function login(ctx) {
    const c = ctx.req.corpo || {};
    const email = R.verificarCredencial(ctx.config, ctx.req.credencial || c.credential);
    const usuario = R.usuarioAtivo(ctx.repo, email);
    if (!usuario) throw R.erro(403, "conta não autorizada");
    return { status: 200, corpo: R.usuarioPublico(usuario) };
  }

  const me = (ctx) => ({ status: 200, corpo: R.usuarioPublico(ctx.usuario) });
  const logout = () => ({ status: 200, corpo: { status: "ok" } });
  const saude = () => ({ status: 200, corpo: { status: "ok" } });

  // ---------- usuários autorizados (somente administrador) ----------

  const usuarioLinha = (u) => ({ email: u.email, nome: u.nome, perfil: u.perfil, crmv: u.crmv,
    ativo: u.ativo });

  function listarUsuarios(ctx) {
    return { status: 200, corpo: ctx.tx.todos("Usuario").map(usuarioLinha) };
  }

  function exigirCrmv(perfil, crmv) {
    if (perfil === "VETERINARIO" && !(crmv || "").trim()) {
      throw R.erro(422, { codigo: "crmv_obrigatorio", mensagem: "Veterinário exige o CRMV." });
    }
  }

  function criarUsuario(ctx) {
    const { tx } = ctx;
    const c = V.objeto(ctx.req.corpo);
    const email = V.preenchido(c, "email").toLowerCase();
    if (!email.includes("@")) throw V.invalido("email", "e-mail inválido");
    const nome = V.preenchido(c, "nome");
    const perfil = V.opcao(V.textoObrigatorio(c, "perfil"), "perfil",
      ["ADMIN", "VETERINARIO", "SECRETARIA"]);
    const crmv = R.txt(V.textoOpcional(c, "crmv"));
    exigirCrmv(perfil, crmv);
    if (tx.obter("Usuario", email)) {
      throw R.erro(409, { codigo: "usuario_existente", mensagem: "Já existe um usuário com este e-mail." });
    }
    tx.inserir("Usuario", { email, nome, perfil, crmv, ativo: "SIM" });
    R.auditar(ctx, "CRIAR", "Usuario", email);
    return { status: 201, corpo: usuarioLinha(tx.obter("Usuario", email)) };
  }

  function atualizarUsuario(ctx) {
    const { tx } = ctx;
    const email = ctx.req.params[0].toLowerCase();
    const atual = tx.obter("Usuario", email);
    if (!atual) throw R.erro(404, "usuário não encontrado");
    const c = V.objeto(ctx.req.corpo);
    const novo = { nome: atual.nome, perfil: atual.perfil, crmv: atual.crmv, ativo: atual.ativo };
    if (V.tem(c, "nome")) novo.nome = V.preenchido(c, "nome");
    if (V.tem(c, "perfil")) novo.perfil = V.opcao(c.perfil, "perfil", ["ADMIN", "VETERINARIO", "SECRETARIA"]);
    if (V.tem(c, "crmv")) novo.crmv = R.txt(V.textoOpcional(c, "crmv"));
    if (V.tem(c, "ativo")) novo.ativo = V.opcao(c.ativo, "ativo", ["SIM", "NAO"]);
    exigirCrmv(novo.perfil, novo.crmv);
    const eraAdminAtivo = atual.perfil === "ADMIN" && atual.ativo === "SIM";
    const continuaAdminAtivo = novo.perfil === "ADMIN" && novo.ativo === "SIM";
    if (eraAdminAtivo && !continuaAdminAtivo) {
      const outros = tx.todos("Usuario").filter((u) => u.email !== email
        && u.perfil === "ADMIN" && u.ativo === "SIM");
      if (!outros.length) {
        throw R.erro(409, { codigo: "ultimo_administrador",
          mensagem: "Deve existir ao menos um administrador ativo." });
      }
    }
    for (const [campo, valor] of Object.entries(novo)) {
      if (atual[campo] !== valor) {
        tx.atualizar("Usuario", email, { [campo]: valor });
        R.auditar(ctx, "ALTERAR", "Usuario", email, campo, atual[campo], valor);
      }
    }
    const antes = atual.ativo === "SIM" ? atual.perfil : null;
    const depois = novo.ativo === "SIM" ? novo.perfil : null;
    return { status: 200, corpo: usuarioLinha(tx.obter("Usuario", email)) };
  }

  // ---------- auditoria e integridade ----------

  function listarAuditoria(ctx) {
    const q = ctx.req.query;
    let limite = 200;
    if (q.limite !== undefined) {
      limite = Number(q.limite);
      if (!Number.isInteger(limite) || limite < 1 || limite > 1000) {
        throw V.invalido("limite", "Input should be between 1 and 1000");
      }
    }
    const linhas = ctx.tx.todos("Auditoria").map((a, i) => ({ a, i }))
      .filter(({ a }) => (!q.entidade || a.entidade === q.entidade)
        && (!q.id_entidade || a.id_entidade === q.id_entidade)
        && (!q.usuario || a.usuario_email === q.usuario)
        && (!q.acao || a.acao === q.acao)
        && (!q.de || a.data_hora.slice(0, 10) >= q.de)
        && (!q.ate || a.data_hora.slice(0, 10) <= q.ate))
      .sort((x, y) => (x.a.data_hora < y.a.data_hora ? 1 : (x.a.data_hora > y.a.data_hora ? -1
        : y.i - x.i)));
    return { status: 200, corpo: linhas.slice(0, limite).map(({ a }) => a) };
  }

  /** Confere, para cada atendimento encerrado, o selo dos dados e o hash do documento. */
  function verificarIntegridade(ctx) {
    const { tx, amb, repo } = ctx;
    const divergentes = [];
    let total = 0;
    for (const at of tx.todos("Atendimento")) {
      if (at.status !== "ENCERRADO") continue;
      total += 1;
      const valores = R.valoresDoAtendimento(tx, at.id_atendimento);
      const motivos = [];
      if (!at.selo_integridade || R.seloDoAtendimento(amb, at, valores) !== at.selo_integridade) {
        motivos.push("dados_alterados");
      }
      const conteudo = at.arquivo_pdf ? repo.lerArquivo(at.arquivo_pdf) : null;
      // Aparelho: o arquivo vive no Drive e é conferido ao abri-lo; aqui só os dados.
      const noDrive = amb.documentoPosterior === true && !conteudo
        && (at.documento_estado === "PENDENTE" || at.documento_estado === "GERADO"
          || at.documento_nome);
      if (noDrive) { /* sem arquivo local por desenho */ }
      else if (conteudo === null) motivos.push("documento_ausente");
      else if (amb.sha256(conteudo) !== at.hash_sha256) motivos.push("documento_alterado");
      if (motivos.length) divergentes.push({ id: at.id_atendimento, motivos });
    }
    return { status: 200, corpo: { ok: divergentes.length === 0, total, divergentes } };
  }

  // ---------- tabela de rotas do roteador ----------

  R.ROTAS.push(
    { m: "POST", r: /^\/api\/auth\/login$/, perfis: PUBLICA, grava: false, h: login },
    { m: "GET", r: /^\/api\/auth\/me$/, perfis: null, grava: false, h: me },
    { m: "POST", r: /^\/api\/auth\/logout$/, perfis: PUBLICA, grava: false, h: logout },
    { m: "GET", r: /^\/api\/health$/, perfis: PUBLICA, grava: false, h: saude },
    { m: "GET", r: /^\/api\/usuarios$/, perfis: ["ADMIN"], grava: false, h: listarUsuarios },
    { m: "POST", r: /^\/api\/usuarios$/, perfis: ["ADMIN"], grava: true, h: criarUsuario },
    { m: "PATCH", r: /^\/api\/usuarios\/([^/]+)$/, perfis: ["ADMIN"], grava: true,
      h: atualizarUsuario },
    { m: "GET", r: /^\/api\/auditoria$/, perfis: ["ADMIN"], grava: false, h: listarAuditoria },
    { m: "GET", r: /^\/api\/integridade$/, perfis: ["ADMIN"], grava: false,
      h: verificarIntegridade },
  );

  // ---------- roteador ----------

  function parseCaminho(caminho) {
    const [path, qs] = String(caminho).split("?");
    const query = {};
    if (qs) {
      for (const par of qs.split("&")) {
        if (!par) continue;
        const i = par.indexOf("=");
        const dec = (s) => decodeURIComponent(s.replace(/\+/g, " "));
        query[dec(i < 0 ? par : par.slice(0, i))] = i < 0 ? "" : dec(par.slice(i + 1));
      }
    }
    return { path, query };
  }

  R.criarApi = function criarApi({ repo, amb, config }) {
    const cfg = config || {};

    function tratarInterno(env) {
      if (!env || typeof env !== "object" || typeof env.metodo !== "string"
        || typeof env.caminho !== "string") {
        throw R.erro(422, "envelope inválido");
      }
      const metodo = env.metodo.toUpperCase();
      const { path, query } = parseCaminho(env.caminho);

      let achada = null;
      let caminhoExiste = false;
      for (const rota of R.ROTAS) {
        const m = rota.r.exec(path);
        if (!m) continue;
        caminhoExiste = true;
        if (rota.m === metodo) { achada = { rota, params: m.slice(1).map(decodeURIComponent) }; break; }
      }
      if (!achada) throw R.erro(caminhoExiste ? 405 : 404, caminhoExiste ? "Method Not Allowed" : "Not Found");

      const { rota, params } = achada;
      const req = { metodo, caminho: path, query, params, corpo: env.corpo === undefined ? {} : env.corpo,
        idOp: env.idOp || null, credencial: env.credencial || null };
      const ctx = { amb, repo, config: cfg, req, usuario: null, email: null, tx: null };

      if (rota.perfis !== PUBLICA) {
        const email = R.verificarCredencial(cfg, req.credencial);
        const usuario = R.usuarioAtivo(repo, email);
        ctx.email = email;
        if (rota.perfis === CONTA) {
          ctx.usuario = usuario;   // pode ser null: conta Google ainda sem acesso (convite)
        } else {
          if (!usuario) throw R.erro(401, "usuário não autorizado");
          if (rota.perfis && !rota.perfis.includes(usuario.perfil)) {
            throw R.erro(403, "perfil sem permissão");
          }
          ctx.usuario = usuario;
        }
      }

      const grava = typeof rota.grava === "function" ? rota.grava(req) : rota.grava;
      if (grava) {
        return R.executarGravacao(repo, amb,
          { idOp: req.idOp, usuarioEmail: ctx.email },
          (tx) => rota.h({ ...ctx, tx }));
      }
      return R.executarLeitura(repo, (tx) => rota.h({ ...ctx, tx }));
    }

    function tratar(env) {
      try {
        return tratarInterno(env);
      } catch (e) {
        if (e instanceof R.ProcessoInterrompido) throw e;
        if (e instanceof R.HttpErro) return { status: e.status, corpo: { detail: e.detail } };
        if (typeof console !== "undefined" && console.error) console.error(e);
        return { status: 500, corpo: { detail: "erro interno" } };
      }
    }

    return { tratar };
  };
})(RoniVet);
