# Cadastro no Google Cloud para o APK (feito uma vez, por quem publica o aplicativo)

Quem **instala** o aplicativo na clínica não faz nada disto: só abre o app e entra com a sua
conta Google. Este roteiro é de quem **gera e distribui o APK**, e é feito uma única vez.

O que o cadastro faz: identifica o **aplicativo** para o Google (nome do pacote + impressão
digital da chave de assinatura) para que ele possa pedir acesso ao Drive. Os dados da clínica
ficam no Drive da conta da própria clínica; este projeto não guarda nenhum dado.

## O que será criado

| Item | Valor |
|---|---|
| Projeto no Google Cloud | qualquer nome (ex.: `RoniVet`) |
| API ativada | Google Drive API |
| Tela de consentimento | Externa; escopo `drive` (e e-mail) |
| ID de cliente OAuth | tipo **Android**: pacote `br.com.ronivet.app` + SHA-1 da chave |
| ID de cliente **Web** | **não é necessário** |
| Script, servidor ou chave secreta | **não são necessários** |

## Passo a passo

1. Entre em <https://console.cloud.google.com> com uma conta Google (pode ser a sua; não precisa
   ser a da clínica) e crie um projeto novo.
2. **APIs e serviços › Biblioteca**: procure **Google Drive API** e clique em **Ativar**.
3. **APIs e serviços › Tela de consentimento OAuth** (ou "Google Auth Platform"):
   - tipo de usuário: **Externo**;
   - nome do app: `RoniVet`; e-mail de suporte e de contato: o seu;
   - **Escopos** (*Acesso a dados*): adicione `.../auth/drive` (e `email`/`profile`, se pedidos).
     É o escopo que permite ao aplicativo **ver a pasta que a clínica compartilha** com cada
     pessoa; o aplicativo só usa a pasta `RoniVet`, mas a permissão concedida ao Google é a de
     acesso ao Drive (escopo "restrito"; ver `PRIVACIDADE.md`);
   - **Usuários de teste**: cada pessoa da equipe entra com a **própria conta Google**. Em modo de
     teste todas precisam estar na lista (até 100) e a autorização expira em 7 dias; por isso
     publique o aplicativo (seção abaixo) para a clínica não precisar manter a lista.
4. **APIs e serviços › Credenciais › Criar credenciais › ID do cliente OAuth**:
   - tipo de aplicativo: **Android**;
   - nome do pacote: `br.com.ronivet.app`;
   - impressão digital do certificado **SHA-1**: a da chave que assina o APK (ver abaixo).
   Não é preciso copiar nenhum valor para o aplicativo: o Google reconhece o app pelo par
   pacote + SHA-1.
5. Se houver mais de uma chave (depuração e produção), crie **um ID de cliente Android para cada
   SHA-1**.

## SHA-1 da chave de assinatura

- **Chave de depuração** (APK de teste): `keytool -list -v -alias androiddebugkey -keystore
  %USERPROFILE%\.android\debug.keystore -storepass android -keypass android`
  (neste computador: `4F:D5:48:EC:12:20:39:E4:BE:6B:C7:BE:6F:32:2B:B0:43:78:47:36`).
- **Chave de produção**: `keytool -list -v -keystore <arquivo.jks> -alias <alias>`. Guarde o
  arquivo e a senha fora do repositório: sem eles não é possível atualizar o app já instalado.

## Publicar o aplicativo (recomendado: evita manter lista de e-mails)

Em modo **Teste**, só entram as contas cadastradas como "usuários de teste" e a autorização
expira a cada 7 dias. Para não ter que administrar lista nenhuma, **publique o aplicativo uma
vez**:

1. **Tela de consentimento** (ou **Google Auth Platform**) › **Público-alvo** › **Publicar o
   app** › confirme.
2. O status passa de "Teste" para **Em produção**.

O RoniVet usa o escopo `drive`, que o Google classifica como **restrito**. Publicado **sem
verificação**, o aplicativo funciona, mas: (i) cada pessoa vê o aviso "app não verificado" e
precisa tocar em *Avançado › Continuar*; (ii) o Google limita a **100 contas** no total. Para
uma clínica isso costuma bastar. Para remover o aviso e o limite é preciso a verificação do
Google (avaliação de segurança, com custo). Informe o link do `PRIVACIDADE.md` publicado no
repositório como política de privacidade.

Depois de publicado, **não há nada para manter**: nenhum e-mail para cadastrar e nenhuma
renovação.

Enquanto estiver em **Teste** (antes de publicar): só as contas listadas conseguem autorizar
(até 100) e a autorização do Drive vale por 7 dias; depois o app pede para entrar de novo (os
dados locais e as operações pendentes são mantidos).

## Conferência

Com o APK instalado (na conta de teste, se o app ainda estiver em modo de teste):
1. toque em **Criar a clínica** (ou em **Entrar com a minha conta Google**);
2. escolha a conta e aceite o acesso ao Drive;
3. o app deve concluir a entrada e, no Drive da conta, criar a pasta `RoniVet`.

Erro `10` (DEVELOPER_ERROR) ou `8` (`UNREGISTERED_ON_API_CONSOLE`) = pacote + SHA-1 não batem com
um ID de cliente Android cadastrado (ou ainda não existe nenhum). É o que aparece enquanto o
cadastro das seções acima não foi feito.
