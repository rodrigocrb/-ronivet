# RoniVet

Agendamento e atendimento para clínicas veterinárias, em um **aplicativo Android** que funciona
**sem internet** e sem servidor: cada celular tem o seu banco de dados e os celulares da equipe se
sincronizam por uma pasta compartilhada do **Google Drive** da clínica.

- Agenda, cadastro de tutores e animais, ficha clínica por tipo de atendimento (vacina, consulta…).
- Encerramento do atendimento com **documento em PDF** (modelo `.docx` da própria clínica), guardado
  no Drive e com hash de integridade.
- Cada pessoa entra com a **própria conta Google**; a administração cadastra a equipe e convida
  pelo e-mail. Perfis: administrador, veterinário e secretária.
- Campanha de lembretes de reforço vacinal, painel e auditoria.

## Documentação

| Para quem | Documento |
|---|---|
| **Clínica (uso diário)** | [`docs/instalacao-clinica.md`](docs/instalacao-clinica.md) |
| **Quem publica o app (instalação)** | [`docs/instalacao.md`](docs/instalacao.md) e [`docs/google-cloud-apk.md`](docs/google-cloud-apk.md) |
| Como funciona | [`docs/arquitetura.md`](docs/arquitetura.md) |
| Desenvolvimento e testes | [`docs/desenvolvimento.md`](docs/desenvolvimento.md) |
| Roteiro de testes de aceitação | [`docs/roteiro-testes.md`](docs/roteiro-testes.md) |
| LGPD e operação | [`docs/lgpd.md`](docs/lgpd.md) |

## Início rápido (desenvolvedor)

```
npm install
npm run test:js          # núcleo + aplicativo
cd android && npm install && node sincronizar.js
cd android && gradlew.bat assembleDebug     # APK de depuração
```

Requisitos: Node.js 20+, JDK 21 e Android SDK 34. Veja [`docs/instalacao.md`](docs/instalacao.md).

## Licença, privacidade e avisos

- [`LICENSE`](LICENSE): licença MIT. O software é fornecido sem garantia.
- [`PRIVACIDADE.md`](PRIVACIDADE.md): que dados são tratados, onde ficam e quem é o controlador.
- [`AVISO.md`](AVISO.md): o que o sistema não é (não é assinatura ICP-Brasil) e o que fica sob
  responsabilidade da clínica.

## Estrutura

```
nucleo/     regras de negócio (JS puro) e seus testes
web/        aplicativo embutido no APK (nucleo.js é gerado)
jstests/    testes do aplicativo (motor, sincronização, Drive, documentos)
contrato/   cenários de contrato executados pelo núcleo
android/    projeto Capacitor e plugin nativo de autorização
docs/       documentação
```
