# Roteiro de testes de aceitação

Executar em **celulares Android reais**, com as contas Google da equipe (uma administradora,
uma veterinária e uma secretária) e o APK a testar. Os testes automatizados (`npm run test:js`)
cobrem as regras; este roteiro confere o que só se vê em campo.

Marque cada item: **OK** / **Falhou** (anote o que aconteceu).

## 1. Criação da clínica (administração)

| # | Passo | Esperado |
|---|---|---|
| 1 | Abrir o app, dar nome ao aparelho, informar nome e (se atende) CRMV, tocar em **Criar a clínica** | Seletor de contas Google; aviso de "app não verificado" (*Continuar*); consentimento do Drive |
| 2 | Concluir | Entra no app como administradora; pasta `RoniVet` existe no Drive |
| 3 | Menu › Horários de atendimento: definir expediente e salvar | "Horários salvos." |
| 4 | Menu › Tipos de atendimento: abrir "Vacina", conferir perguntas | Produto, lote, data da aplicação, próxima dose |
| 5 | Menu › Pessoas: cadastrar a veterinária e a secretária com o e-mail Google delas | Convite enviado; o Google avisa por e-mail |

## 2. Entrada da equipe

| # | Passo | Esperado |
|---|---|---|
| 6 | Em outro celular: instalar, nome do aparelho, **Entrar com a minha conta Google** | Entra na clínica (pode demorar alguns minutos) |
| 7 | Conta não cadastrada tenta entrar | Mensagem de conta não cadastrada |
| 8 | Conta cadastrada, sem pasta compartilhada | "A pasta da clínica ainda não foi compartilhada…" |
| 9 | Abrir o menu ☰ como secretária e como veterinária | Cada perfil vê só suas telas |

## 3. Agenda e atendimento

| # | Passo | Esperado |
|---|---|---|
| 10 | Secretária: agendar com tutor e animal novos (CPF opcional) | Aparece na agenda |
| 11 | Secretária: tentar o mesmo horário | Recusado: "Horário já ocupado" |
| 12 | Veterinária: abrir o atendimento, preencher e **Encerrar** | Encerra sem internet; documento "sendo gerado" |
| 13 | Com internet: aguardar a sincronização | Documento gerado; **Abrir PDF** mostra o PDF com dados e CRMV |
| 14 | Secretária tenta abrir a ficha clínica | Sem acesso a dados clínicos |
| 15 | Aditamento em atendimento encerrado | Registrado, o original não muda |

## 4. Offline e conflitos

| # | Passo | Esperado |
|---|---|---|
| 16 | Dois celulares em modo avião: agendar o **mesmo horário** em cada | Ambos aceitam localmente |
| 17 | Reconectar os dois | Um agendamento fica; o outro aparece em *Sincronização › Conflitos*, igual nos dois |
| 18 | Encerrar atendimento em modo avião; reconectar | Documento é gerado depois, uma só vez |

## 5. Documentos

| # | Passo | Esperado |
|---|---|---|
| 19 | Tipos › Salvar modelo inicial no Drive; editar no computador (logo/texto) e enviar em **Enviar modelo** | Mensagem com os marcadores usados |
| 20 | Encerrar atendimento do tipo | PDF com o modelo preenchido |
| 21 | No Drive pelo computador: `RoniVet/documentos/ANO/` | PDF com nome legível; baixa e imprime |
| 22 | Apagar o PDF no Drive; abrir o atendimento | Aviso de arquivo ausente; **Emitir nova via** gera a "2a via" |

## 6. Acesso e segurança

| # | Passo | Esperado |
|---|---|---|
| 23 | Desativar uma pessoa em Menu › Pessoas | Acesso dela à pasta é retirado; ela deixa de sincronizar |
| 24 | Retirar um aparelho em Sincronização › Aparelhos | Ao conectar, ele apaga os dados e avisa que foi retirado |
| 25 | Token vencido (aguardar ou revogar acesso em myaccount.google.com) | App continua local; pede nova entrada; nada se perde |

## 7. Instalação

| # | Passo | Esperado |
|---|---|---|
| 26 | Instalar uma nova versão do APK por cima | Dados e sincronização mantidos |
