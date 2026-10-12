# Privacidade e proteção de dados

Este documento descreve, em linguagem simples, como o RoniVet trata dados pessoais. Ele
descreve o **comportamento do software**; a clínica que o usa deve adaptá-lo à sua própria
política e, em caso de dúvida, consultar um profissional de proteção de dados.

## Quem é quem

| Papel | Quem |
|---|---|
| **Controladora dos dados** (decide o que fazer com eles) | A clínica que usa o aplicativo |
| **Fornecedor do software** | Quem publica e mantém o código (não recebe nem acessa os dados da clínica) |
| **Armazenamento** | O Google Drive da conta Google usada pela clínica, sob os termos entre a clínica e o Google |

## Que dados o aplicativo trata

- **Tutores:** nome, telefone e, opcionalmente, CPF, e-mail e endereço.
- **Animais:** nome, espécie, sexo, raça, nascimento, pelagem.
- **Atendimentos:** tipo, data e hora, respostas clínicas preenchidas pelo veterinário,
  documentos em PDF e histórico de alterações (quem fez o quê e quando).
- **Pessoas que usam o app:** nome, e-mail e perfil, para organizar as telas e a auditoria.

## Onde os dados ficam

1. **No aparelho:** um banco de dados local, que permite usar o aplicativo sem internet.
2. **No Google Drive da administração, compartilhada com a equipe:** uma pasta `RoniVet` com os registros de operações
   (para sincronizar os aparelhos), cópias de estado e os documentos em PDF.

**O aplicativo não envia dados ao desenvolvedor, a servidores do projeto nem a terceiros**
(além do Google, pelo Drive da própria clínica). Não há análise de uso, anúncios nem
rastreamento.

## Acesso ao Google Drive

Cada pessoa entra com a **própria conta Google**. Para enxergar a pasta `RoniVet` que a clínica
compartilha com ela, o aplicativo pede o acesso **`drive`** do Google, que, tecnicamente, vale
para **todo o Drive daquela conta**. O aplicativo usa **somente** a pasta `RoniVet` (reconhecida
por uma marca gravada nela) e o seu conteúdo: não lê, lista nem altera outros arquivos e pastas.
Por ser um acesso amplo, só o conceda se confiar nesta decisão; o código é aberto para
conferência. A autorização pode ser revogada a qualquer momento em
<https://myaccount.google.com/permissions>.

**Convite e revogação:** a administração cadastra o e-mail da pessoa em *Menu › Pessoas*,
o que compartilha a pasta com ela (o Google avisa por e-mail). Ao desativar a pessoa, o acesso à
pasta é retirado. Os arquivos que cada pessoa cria (lotes de sincronização, PDFs) pertencem à
conta dela no Drive e ocupam a cota dela; se a conta for excluída, esses arquivos são perdidos.

## Segurança: limites que a clínica precisa conhecer

- **Os perfis (administrador, veterinário, secretária) organizam as telas e a auditoria, mas
  não são controle de acesso.** Quem usa um aparelho da clínica desbloqueado, ou tem acesso à
  pasta compartilhada, pode abrir todos os dados.
- Mantenha o **bloqueio de tela** ativo nos aparelhos e proteja a conta Google com verificação
  em duas etapas.
- Um aparelho perdido contém uma cópia dos dados. Remova-o da clínica o quanto antes (função de
  retirada de aparelho) e troque a senha da conta Google.
- Quem tem acesso à pasta `RoniVet` (a conta que a criou e as contas com as quais ela foi
  compartilhada) tem acesso a todos os dados.

## Direitos dos titulares (LGPD)

Pedidos de acesso, correção ou eliminação de dados de tutores devem ser atendidos **pela
clínica**, que é a controladora. O aplicativo permite consultar e corrigir cadastros; a
eliminação definitiva de registros clínicos deve observar os prazos de guarda exigidos pela
legislação e pelo conselho profissional aplicável.

## Retenção e cópia de segurança

- Os dados permanecem até a clínica apagá-los.
- A pasta `RoniVet` no Drive funciona como cópia dos dados e permite recuperar um aparelho
  novo. A clínica é responsável por manter a conta Google ativa e por fazer as cópias de
  segurança que julgar necessárias.

## Mudanças deste documento

Alterações são registradas no histórico do repositório.
