# Instalação do RoniVet na clínica (modo atual: sem servidor)

Este guia é para quem **usa** o aplicativo. Não precisa de computador, servidor nem
conhecimento técnico. Os dados ficam em cada celular e são compartilhados por uma **pasta no
Google Drive**: a administração cria a clínica com a conta Google dela e convida as demais
pessoas pelo e-mail.

> A parte técnica de quem publica o aplicativo (uma única vez) está em
> [`google-cloud-apk.md`](google-cloud-apk.md).

## O que você precisa

- Os celulares Android da equipe (Android 8 ou mais novo). **Cada celular é de uma pessoa.**
- **Uma conta Google para cada pessoa** (a conta pessoal ou uma criada para o trabalho).
- O arquivo do aplicativo (`RoniVet.apk`), entregue por quem publica o aplicativo.

## 1. Instalar o aplicativo (em cada celular)

1. Copie o `RoniVet.apk` para o celular (WhatsApp, cabo ou Drive) e toque nele.
2. Se o Android perguntar, permita "instalar apps desconhecidos" para o aplicativo que você
   usou para abrir o arquivo.
3. Abra o **RoniVet**.

## 2. Administração: criar a clínica (uma vez, no primeiro celular)

1. Em **Nome deste aparelho**, escreva um nome (ex.: *Celular da Dra. Ana*).
2. Em **Primeira abertura**, digite o seu nome. Marque *Sou veterinário(a)* se também atende e
   informe o CRMV (assim você encerra atendimentos com um único acesso).
3. Toque em **Criar a clínica neste aparelho**, escolha a **sua conta Google** e aceite o
   acesso ao Drive. A pasta `RoniVet` é criada no seu Drive e você passa a ser a administração.
4. Em **Menu › Pessoas**, **adicione cada pessoa da equipe com o e-mail da conta
   Google dela** e o perfil. Ao adicionar, o aplicativo compartilha a pasta com aquela conta e o
   Google envia o convite por e-mail.
5. No menu (☰), em **Administração**, cadastre os **Horários de atendimento** e os **Tipos de
   atendimento**.

## 3. Cada pessoa convidada

1. Instale o aplicativo e dê um nome ao aparelho.
2. Toque em **Entrar com a minha conta Google** (em *Fui convidado(a) para uma clínica*), escolha
   a **sua** conta e aceite o acesso ao Drive.
3. Aguarde. **Na primeira vez pode levar alguns minutos**; não feche o aplicativo.
4. Nas próximas vezes, o aplicativo entra direto com a sua conta, com o seu nome e perfil.

> Se aparecer "A pasta da clínica ainda não foi compartilhada com esta conta", a administração
> precisa cadastrar o e-mail exato desta conta em *Menu › Pessoas* (ou tocar em
> **Convidar** ao lado da pessoa).

## Como o dia a dia funciona

- **Funciona sem internet.** Tudo o que você registra fica no celular e é enviado quando houver
  conexão. O aplicativo sincroniza sozinho (a cada 5 minutos e logo depois de salvar).
- **Mesmo horário em dois celulares:** vale o que chegou primeiro. O outro aparece em
  *Sincronização › Conflitos para conferir*, para ser refeito.
- **Encerrar o atendimento não depende de internet.** O PDF é gerado quando o celular
  sincroniza; até lá o documento aparece como "sendo gerado".
- **Documentos:** ficam no Drive da clínica, em `RoniVet/documentos/ANO/`, com nome legível
  (data, animal, tutor, tipo). Podem ser baixados e impressos pelo computador, em
  <https://drive.google.com>, com a sua conta Google (a pasta é compartilhada com você). O celular **não guarda** o PDF.
- **Se o PDF sumir do Drive:** na tela do atendimento use **Emitir nova via**. O registro da via
  original fica no histórico.
- **Modelo do documento:** em *Administração › Tipos de atendimento*, toque em **Salvar modelo
  inicial no Drive**. No computador, abra `RoniVet/modelos-iniciais/` no Drive, edite no Word ou
  no Google Docs (logo, marca d'água, texto) mantendo os `{marcadores}` e, no celular, envie o
  arquivo de volta em **Enviar modelo**.

## Pessoa saiu da equipe? Perdeu um celular?

- **Pessoa que saiu:** em *Menu › Pessoas*, toque em **Desativar**. O acesso dela à pasta
  da clínica é retirado e ela deixa de sincronizar.
- **Celular perdido:** em *Sincronização › Aparelhos da clínica*, toque em **Retirar** no
  aparelho, escreva o motivo e confirme. Quando ele se conectar, **apaga os dados da clínica**.
  Se nunca mais se conectar, desative também a pessoa (acima) e peça que ela troque a senha da
  conta Google.

Retire também aparelhos que não serão mais usados: um aparelho parado por muito tempo impede o
sistema de "fechar" cópias internas de estado (instantâneos).

## Cuidados

- **Bloqueio de tela** em todos os celulares (PIN, senha ou digital).
- **Segurança da conta Google:** ative a verificação em duas etapas na sua conta. Quem entra na
  sua conta tem acesso aos dados da clínica.
- **Perfis (administrador, veterinário, secretária) organizam as telas e o registro de quem
  fez o quê. Não são controle de segurança:** quem tem o celular desbloqueado e a conta da
  clínica pode acessar os dados.
- **Cópia de segurança:** mantenha também uma cópia periódica da pasta `RoniVet` (Drive ›
  Baixar) em local seguro.
- Leia [`AVISO.md`](../AVISO.md) e [`PRIVACIDADE.md`](../PRIVACIDADE.md).

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "Conta Google precisa entrar de novo" | Em *Sincronização*, toque em **Entrar de novo na conta Google**. O que foi feito está guardado e será enviado. |
| "Este aplicativo ainda não está cadastrado no Google (erro 10 ou 8)" | Quem publicou o aplicativo precisa concluir o cadastro (ver `google-cloud-apk.md`). |
| "Acesso bloqueado" ou "app não verificado" | Se aparecer *Avançado › Continuar*, toque nele (aplicativo ainda sem verificação do Google). Se bloquear, quem publicou deve **publicar o app** ou adicionar a conta em *Usuários de teste*. |
| Documento sempre "sendo gerado" | Abra *Sincronização*, confira a conexão e a conta Google; toque em **Gerar agora** na tela do atendimento. |
| Cota do Google atingida | Aguarde: o aplicativo tenta de novo sozinho. Nada se perde. |

## Limites do modo de teste do Google

Enquanto o aplicativo do Google Cloud estiver em **modo de teste**, só contas em *Usuários de
teste* conseguem conectar (até 100) e a autorização expira a cada 7 dias (basta entrar de
novo). Ao **publicar o app** ("Em produção") isso deixa de valer e a lista não precisa ser
mantida; aparece apenas o aviso de "app não verificado" na primeira conexão.
