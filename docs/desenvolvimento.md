# Desenvolvimento

## Estrutura do repositório

```
nucleo/              regras de negócio (JavaScript puro, sem dependências)
  src/               módulos 00–70 (domínio, agenda, ficha, documentos, roteador)
  test/              testes do núcleo (repositório em memória)
  montar_nucleo.js   gera web/nucleo.js a partir de src/
web/                 aplicativo (HTML/JS/CSS) embutido no APK
  nucleo.js          GERADO por nucleo/montar_nucleo.js — não edite
jstests/             testes do aplicativo (motor, sincronização, Drive, documentos, telas)
contrato/            cenários de contrato (JSON) executados pelo núcleo e pelo modo do aparelho
android/             projeto Capacitor + plugin nativo RoniDriveAuth (Java)
scripts/             gerar_mascote.py (ícones e mascote)
docs/                documentação
dist/                APK gerado (ignorado pelo git)
```

## Testes

Requer apenas Node.js 20+ (e `npm install` na raiz para o `fake-indexeddb`):

```
npm install
npm run test:js         # núcleo + aplicativo (~360 testes, poucos segundos)
```

| Grupo | O que cobre |
|---|---|
| `nucleo/test` | Regras, perfis, auditoria, integridade, desempenho do domínio |
| `jstests/registro`, `simulador`, `conflitos` | Ordem total, convergência de N aparelhos, conflitos |
| `jstests/sincronizacao*`, `drive_rest`, `raiz`, `agendador` | Lotes, instantâneos, cliente REST do Drive (servidor falso) |
| `jstests/documento_*`, `docx`, `pdf_texto`, `reemissao` | Geração de documentos e nova emissão |
| `jstests/sync_app`, `local_app`, `retirada`, `admin_atende` | Fluxos do aplicativo |
| `jstests/contrato_local` | Cenários de `contrato/` pelo modo do aparelho |

Depois de alterar `nucleo/src`, regenere o arquivo do aplicativo:

```
node nucleo/montar_nucleo.js          # grava web/nucleo.js
node nucleo/montar_nucleo.js --verificar
```

## Executar no navegador (sem Android)

`web/` é estático. Sirva a pasta e abra no navegador:

```
npx http-server web -p 8080      # ou qualquer servidor estático
```

No navegador o banco local (IndexedDB) funciona, mas a conexão com o Google Drive só existe no
aplicativo Android; a entrada usa a lista "Quem está usando?".

## Aplicativo Android

Veja [`instalacao.md`](instalacao.md) (build, assinatura e distribuição) e
[`google-cloud-apk.md`](google-cloud-apk.md). O plugin nativo está em
`android/android/app/src/main/java/br/com/ronivet/app/RoniDriveAuthPlugin.java`.

## Convenções

- Interface e mensagens em português do Brasil, linguagem simples.
- Dados com ids determinísticos: dentro do núcleo use `amb.novoId()` e `amb.agora()`, nunca
  `Math.random()` nem `Date.now()` (a operação precisa dar o mesmo resultado em todos os aparelhos).
- Toda mudança de regra deve ter teste em `nucleo/test` ou `jstests`.
