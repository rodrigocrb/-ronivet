# Aplicativo Android do RoniVet (Capacitor)

Embute `../web/` em um APK. Não há configuração embutida: o núcleo de regras roda no aparelho e a
conta Google é escolhida na entrada.

- Cadastro no Google Cloud: [`../docs/google-cloud-apk.md`](../docs/google-cloud-apk.md)
- Gerar, assinar e distribuir o APK: [`../docs/instalacao.md`](../docs/instalacao.md)

## Resumo para gerar o APK de depuração

```
npm install                  # uma vez
node sincronizar.js          # copia ../web para o projeto Android
cd android
gradlew.bat assembleDebug    # precisa de JAVA_HOME (JDK 21) e android/local.properties (sdk.dir)
```

Saída: `android/app/build/outputs/apk/debug/app-debug.apk`.

## Plugin nativo

`android/app/src/main/java/br/com/ronivet/app/RoniDriveAuthPlugin.java` usa a API de Autorização
do Google Play Services para pedir o acesso ao Drive da conta escolhida (escopo `drive`).
Plugins Capacitor usados: `@capacitor/filesystem` e `@capacitor-community/file-opener` (abrir o
PDF no visualizador do Android).
