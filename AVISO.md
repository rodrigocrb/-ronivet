# Aviso importante

O RoniVet é um software livre distribuído **sem garantia** (veja `LICENSE`). Antes de usá-lo em
uma clínica, leia o que ele **não** é e o que continua sendo responsabilidade de quem o usa.

## O que ele não é

- **Não é assinatura digital qualificada.** Os documentos em PDF levam um *hash* (SHA-256) e um
  selo de integridade dos dados, que permitem detectar alterações. Isso **não** é assinatura
  ICP-Brasil nem substitui exigências legais de assinatura.
- **Não garante conformidade regulatória.** Exigências do conselho profissional (CFMV/CRMV),
  prazos de guarda de prontuário, receituário controlado e demais normas aplicáveis continuam
  sendo da clínica e do profissional responsável.
- **Não é um serviço gerenciado.** Não há servidor, suporte ou disponibilidade garantidos pelos
  autores. O funcionamento depende do aparelho, da conta Google e do Google Drive.
- **Não impõe permissões por pessoa.** Os perfis organizam a interface; quem tem acesso ao
  aparelho ou à pasta compartilhada da clínica pode ver todos os dados (veja `PRIVACIDADE.md`).

## O que fica por conta da clínica

1. Usar uma **conta Google da própria clínica**, com verificação em duas etapas, e mantê-la
   ativa (a perda da conta é a perda do acesso à pasta de sincronização).
2. Manter **bloqueio de tela** nos aparelhos e remover aparelhos perdidos.
3. Fazer **cópias de segurança** adequadas ao seu risco e conferir periodicamente que os dados e
   os documentos estão íntegros.
4. Cumprir a **LGPD** como controladora dos dados (informar os titulares, atender pedidos,
   definir prazos de guarda).
5. Revisar os **documentos gerados** (modelos, marcadores, CRMV) antes de usá-los como
   comprovantes.
6. Testar uma atualização do aplicativo antes de instalá-la em todos os aparelhos.

## Limitações técnicas que podem afetar o uso

- **Conflitos:** dois aparelhos sem conexão podem registrar horários incompatíveis; o sistema
  mantém o primeiro na ordem das operações e lista o outro para conferência humana.
- **Sincronização:** depende de conexão com o Google Drive e de cotas do Google; o uso local
  continua sem internet, mas os aparelhos só se igualam ao sincronizar.
- **Documento em PDF:** é gerado pelo Google Drive depois do encerramento, quando há conexão, e
  fica guardado no Drive (não no aparelho). Se o arquivo for apagado do Drive, é preciso
  emitir uma nova via a partir dos dados.
- **Modo de teste do Google:** enquanto o aplicativo estiver em "Teste" no Google Cloud, a
  autorização expira a cada 7 dias e só contas listadas conseguem entrar.

## Reportar problemas

Abra uma *issue* no repositório com os passos para reproduzir, **sem incluir dados reais de
tutores, animais ou da clínica**.
