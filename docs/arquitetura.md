# Arquitetura do RoniVet

Aplicativo Android (Capacitor) com **banco de dados local em cada aparelho**, sincronizado entre
aparelhos por uma **pasta do Google Drive** compartilhada. Não há servidor, script nem chave
secreta. A especificação completa está em `openspec/changes/app-local-sincronizacao-drive/`.

## Camadas

```
┌─────────────────────────── aparelho (WebView) ───────────────────────────┐
│ interface (web/*.js)  →  transporte local  →  núcleo de regras (nucleo.js) │
│                                   │                    │                   │
│                       motor de operações (registro.js)  banco local         │
│                        ordem total + reconstrução     (IndexedDB)           │
│                                   │                                         │
│                      sincronizador (sincronizacao.js) ──► Google Drive      │
└────────────────────────────────────────────────────────────────────────────┘
```

| Camada | Arquivos | Papel |
|---|---|---|
| Interface | `web/app.js`, `agenda.js`, `atendimento.js`, `config.js`, `relatorios.js` | Telas e menu |
| Núcleo de regras | `nucleo/src/*.js` → `web/nucleo.js` | Domínio e roteador (agenda, ficha, documentos, perfis, auditoria) |
| Banco local | `web/repositorio-local.js` | Tabelas em memória gravadas em IndexedDB (uma transação por operação) |
| Operações e ordem | `web/registro.js` | Cada escrita vira uma operação imutável com relógio lógico híbrido |
| Sincronização | `web/sincronizacao.js`, `agendador.js`, `sync-app.js` | Lotes no Drive, instantâneos, aparelhos |
| Drive | `web/drive-rest.js`, `raiz.js` | Cliente REST da pasta da clínica |
| Documentos | `web/documento-*.js`, `docx.js`, `pdf-texto.js` | Modelo `.docx` ou texto → PDF no Drive |
| Google | `web/google.js`, plugin `RoniDriveAuth` | Autorização com a conta Google da pessoa |

## Princípios

1. **O domínio roda no aparelho.** O roteador do núcleo recebe a requisição, aplica as regras e
   grava no banco local, sem rede.
2. **A unidade replicada é a operação.** Cada requisição que altera dados é uma operação
   `{id, t, c, aparelho, hora, email, metodo, caminho, corpo}`. O estado é a dobra
   determinística das operações em uma ordem total (relógio lógico híbrido). Os aparelhos
   convergem para o mesmo estado, qualquer que seja a ordem de chegada.
3. **Conflitos são decididos pela ordem.** Se duas operações são incompatíveis (mesmo horário,
   mesmo CPF), vale a primeira na ordem; a outra aparece em *Sincronização › Conflitos*.
4. **Nada é editado no Drive:** cada aparelho só cria arquivos novos e imutáveis na própria
   pasta, então não há disputa de escrita.

## Leiaute no Drive

```
RoniVet/                               (propriedade ronivet=clinica)
  aparelhos/<aparelho>.json            nome e "promessa" de ordem do aparelho
  operacoes/<aparelho>/lote-NNNNNN.json  operações do aparelho, com sha256
  instantaneos/inst-...json            estado estável (entrada de aparelhos novos)
  retirados/<aparelho>.json            aparelhos retirados pela administração
  documentos/<ano>/<AAAA-MM-DD Animal - Tutor - Tipo (id).pdf>
  modelos/<sha256>.docx                modelo de documento (por hash)
  modelos-iniciais/modelo-<tipo>.docx  modelo inicial para editar no computador
```

- **Instantâneo:** publicado no ponto estável (menor promessa entre os aparelhos ativos); um
  aparelho novo adota o último e lê as operações seguintes.
- **Retirada:** `retirados/<aparelho>.json` faz o aparelho apagar o banco local e o exclui do
  ponto estável; só valem as operações dele até `ultimoLote`.

## Pessoas, perfis e segurança

- Cada pessoa entra com a **própria conta Google**; o e-mail verificado define o perfil
  (administrador, veterinário, secretária) na lista de pessoas da clínica.
- A administração **convida** compartilhando a pasta `RoniVet` com o e-mail da pessoa (editor) e
  **revoga** retirando o acesso.
- Perfis **organizam a interface e a auditoria; não são controle de segurança**: os dados estão no
  aparelho. A proteção é o bloqueio de tela, a conta Google e a retirada de aparelho.
- A auditoria registra pessoa, aparelho e horário de cada operação.

## Documentos

1. **Encerrar** um atendimento não depende de rede: marca o atendimento como encerrado e o
   documento como *pendente*.
2. Com conexão, o aparelho gera o PDF: texto padrão (determinístico) ou **modelo `.docx`**
   preenchido (`{marcadores}`) e convertido pelo Drive em PDF.
3. O PDF fica **só no Drive**; o aparelho guarda o nome e o hash SHA-256 no atendimento e abre
   o arquivo sob demanda, conferindo o hash. Se o arquivo sumir, é possível **emitir nova via**
   (o hash da emissão anterior fica na auditoria).

## Modelo de dados

As tabelas e colunas estão em `nucleo/src/20_schema.js`: `Usuario`, `Tutor`, `Animal`,
`TipoAtendimento`, `CampoDef`, `Atendimento`, `CampoValor`, `Vacina`, `Aditamento`,
`ContatoCampanha`, `HorarioAtendimento`, `Config`, `Auditoria`, `Operacao`, `Meta`.
Identificadores são UUID gerados de forma determinística a partir da operação; datas são texto
ISO 8601 com fuso; booleanos são `SIM`/`NAO`.

## Decisões e limites

- **Escopo `drive`** do Google: necessário para ver a pasta compartilhada por outra conta; o
  código só usa a pasta `RoniVet` (ver `PRIVACIDADE.md`).
- **Sem servidor** implica que não há quem negue acesso: ver "Pessoas, perfis e segurança".
- **Latência:** a sincronização roda a cada 5 minutos e logo após cada gravação, com conexão.
- **Aparelho parado** impede novos instantâneos até ser retirado.
