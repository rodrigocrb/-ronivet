# RoniVet: LGPD, segurança e operação

> **Rascunho técnico para revisão da clínica.** Itens marcados **[CLÍNICA]** dependem de decisão
> da clínica (e, quando for o caso, de orientação jurídica ou do CRMV). Este documento não é
> parecer jurídico. Veja também [`PRIVACIDADE.md`](../PRIVACIDADE.md) e [`AVISO.md`](../AVISO.md).

## 1. Dados tratados e finalidade

| Dado | Titular | Finalidade | Base legal (a confirmar) |
|---|---|---|---|
| Nome, telefone, CPF, e-mail, endereço | Tutor | Identificação, contato e agendamento | Execução de contrato / procedimentos preliminares |
| Animal, atendimentos, vacinas | Tutor (vinculado) | Prestação do serviço e prontuário | Execução de contrato; obrigação legal/regulatória |
| Contato para lembretes e campanhas | Tutor | Lembrete de reforço vacinal | Consentimento (registrado no sistema) |
| E-mail, nome, CRMV | Pessoa da equipe | Controle de acesso, auditoria e assinatura simples | Legítimo interesse / contrato de trabalho |

**[CLÍNICA]** Definir e registrar o encarregado (DPO) e o canal de atendimento ao titular.

## 2. Onde os dados ficam

- **No aparelho de cada pessoa:** banco local (IndexedDB) com todos os dados da clínica.
- **No Google Drive:** pasta `RoniVet` da conta da administração, compartilhada com a equipe
  (operações, estados e PDFs). O Google atua como operador do armazenamento.
- **Não há servidor do projeto** nem envio de dados a terceiros além do Google.

## 3. Controles implementados

- **Perfis** organizam telas e permissões no aplicativo (secretária não vê dados clínicos; só
  veterinário, ou administrador com CRMV, encerra atendimentos).
- **Auditoria** somente de inserção: criação, alteração, encerramento, emissão de nova via,
  consulta a documento, com pessoa, aparelho e horário.
- **Integridade:** atendimento encerrado é imutável; o documento tem hash SHA-256 e o selo cobre
  os dados do atendimento; a verificação acusa divergência.
- **Consentimento de contato** por tutor (ciência, autorização, data e responsável).
- **Acesso à pasta** concedido e revogado pela administração (convite e desativação).
- **Retirada de aparelho:** o aparelho perdido apaga o banco local ao se conectar.
- **Direitos do titular:** exportação dos dados do tutor, anonimização/eliminação quando permitido
  (atendimentos encerrados são preservados por obrigação de guarda).

## 4. Limites que a clínica precisa aceitar

- **Perfis não são barreira de segurança:** os dados estão no aparelho. Quem usa um celular
  desbloqueado da equipe, ou tem acesso à pasta compartilhada, pode abrir todos os dados.
- **Permissão ampla do Google:** o app pede o acesso `drive` (todo o Drive da conta da pessoa),
  embora use somente a pasta `RoniVet`.
- **Arquivos de cada pessoa:** os lotes e PDFs criados por uma pessoa pertencem à conta dela no
  Drive; se a conta for excluída, perdem-se esses arquivos.
- **Aviso do Google** ("app não verificado") e limite de 100 contas sem verificação do Google.

## 5. Medidas recomendadas à clínica

- **[CLÍNICA]** Bloqueio de tela (PIN/senha/digital) em todos os celulares.
- **[CLÍNICA]** Verificação em duas etapas nas contas Google da equipe.
- **[CLÍNICA]** Desativar a pessoa (e retirar o aparelho, se houver) ao término do vínculo.
- **[CLÍNICA]** Cópia periódica da pasta `RoniVet` em local seguro.
- **[CLÍNICA]** Política de retenção de prontuário conforme a orientação do CRMV.
- **[CLÍNICA]** Texto de ciência/consentimento para os tutores.

## 6. Incidentes

Aparelho perdido ou conta comprometida: (1) retirar o aparelho em *Sincronização › Aparelhos da
clínica*; (2) desativar a pessoa em *Menu › Pessoas*; (3) trocar a senha da conta Google e revogar o
acesso do aplicativo em <https://myaccount.google.com/permissions>; (4) avaliar a necessidade de
comunicação à ANPD e aos titulares (**[CLÍNICA]**).
