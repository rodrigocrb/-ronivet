# Instalação do RoniVet

Este guia é para **quem publica o aplicativo** (gera o APK e prepara o Google). Quem apenas **usa**
o aplicativo na clínica deve ler [`instalacao-clinica.md`](instalacao-clinica.md).

O RoniVet **não tem servidor**: é um aplicativo Android com banco de dados local, que sincroniza
pelo Google Drive. Instalar significa: (1) cadastrar o aplicativo no Google, (2) gerar o APK,
(3) distribuir o APK e criar a clínica.

## Visão geral

| Etapa | Quem | Quando | Documento |
|---|---|---|---|
| 1. Cadastro no Google Cloud | publicador | uma vez | [`google-cloud-apk.md`](google-cloud-apk.md) |
| 2. Gerar o APK | publicador | a cada versão | este guia, seção 2 |
| 3. Instalar e criar a clínica | clínica | uma vez por celular | [`instalacao-clinica.md`](instalacao-clinica.md) |

## 1. Cadastro no Google Cloud (uma vez)

Resumo; o passo a passo completo está em [`google-cloud-apk.md`](google-cloud-apk.md).

1. Crie um projeto no Google Cloud e **ative a Google Drive API**.
2. Configure a **tela de consentimento** (Externo) com o escopo `.../auth/drive`.
3. Crie um **ID de cliente OAuth do tipo Android** com o pacote `br.com.ronivet.app` e o **SHA-1**
   da chave que assina o APK (uma chave de depuração e/ou a de produção, um cliente para cada).
4. **Publique o app** ("Em produção"), para não manter lista de usuários de teste.

Não há ID de cliente "Web", script, chave secreta nem servidor para configurar.

## 2. Gerar o APK

### Requisitos na máquina de build

| Item | Versão |
|---|---|
| Node.js | 20 ou mais novo (testado com 24) |
| JDK | 21 |
| Android SDK | plataforma 34 e build-tools; variável `ANDROID_HOME` |
| Sistema | Windows, Linux ou macOS |

Crie `android/android/local.properties` com o caminho do SDK (barras normais):

```
sdk.dir=D:/dev/android/sdk
```

### Passos

```
cd android
npm install                 # uma vez: dependências do Capacitor
node sincronizar.js         # copia web/ para o projeto Android
cd android
gradlew.bat assembleDebug   # Linux/macOS: ./gradlew assembleDebug
```

Saída: `android/android/app/build/outputs/apk/debug/app-debug.apk` (renomeie para
`RoniVet.apk` ao distribuir). Defina antes `JAVA_HOME` e `ANDROID_HOME`, se não estiverem no
ambiente:

```
set JAVA_HOME=C:\caminho\jdk-21
set ANDROID_HOME=C:\caminho\android-sdk
```

### APK de produção (assinado)

1. Crie uma chave **uma única vez** e guarde o arquivo e as senhas **fora do repositório** (sem
   eles não é possível atualizar o aplicativo já instalado):
   ```
   keytool -genkeypair -v -keystore ronivet.jks -alias ronivet -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Crie `android/android/keystore.properties` (já ignorado pelo git):
   ```
   storeFile=C:/caminho/ronivet.jks
   storePassword=...
   keyAlias=ronivet
   keyPassword=...
   ```
3. Cadastre o **SHA-1** dessa chave como um novo ID de cliente Android no Google Cloud
   (`keytool -list -v -keystore ronivet.jks -alias ronivet`).
4. Gere: `gradlew.bat assembleRelease` → `app/build/outputs/apk/release/app-release.apk`.

Para cada nova versão aumente `versionCode` e `versionName` em `android/android/app/build.gradle`.

## 3. Distribuir e instalar

- Envie o APK à equipe (WhatsApp, e-mail, Drive ou cabo). Em cada celular o Android pede para
  permitir "instalar apps desconhecidos" para o aplicativo usado para abrir o arquivo.
- A **administração** abre o app primeiro e cria a clínica com a conta Google dela; depois
  cadastra a equipe em *Menu › Pessoas*, e cada pessoa entra com a própria conta Google.
  Detalhes em [`instalacao-clinica.md`](instalacao-clinica.md).
- Para atualizar, instale o novo APK por cima: os dados locais e a sincronização são mantidos
  (a assinatura deve ser a mesma).

## 4. Conferência após instalar

1. Criar a clínica no primeiro celular e conectar a conta Google.
2. No Drive da conta deve existir a pasta `RoniVet` com `aparelhos/`, `instantaneos/` e
   `operacoes/`.
3. Cadastrar uma pessoa de teste; ela entra em outro celular com a conta dela e vê os mesmos
   dados.
4. Em modo avião, agendar nos dois celulares o mesmo horário; ao reconectar, um dos agendamentos
   aparece em *Sincronização › Conflitos*.

O roteiro completo está em [`roteiro-testes.md`](roteiro-testes.md).

## Problemas comuns na instalação

| Sintoma | Causa e solução |
|---|---|
| Erro `10` ou `8` ao conectar a conta | Pacote + SHA-1 do APK não correspondem a um ID de cliente Android cadastrado. Confira o SHA-1 da chave que assinou o APK. |
| "Acesso bloqueado: app não verificado" | App em modo de teste e conta fora da lista; publique o app ou adicione a conta. |
| "App não verificado" com *Avançado › Continuar* | Esperado para escopo restrito sem verificação do Google (limite de 100 contas). |
| `gradlew` falha com "SDK location not found" | Falta `android/android/local.properties` com `sdk.dir`. |
| `node sincronizar.js` falha | Rode `npm install` em `android/` e confira o Node. |
