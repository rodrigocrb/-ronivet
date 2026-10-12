package br.com.ronivet.app;

import android.accounts.Account;
import android.app.Activity;
import android.content.Intent;
import android.content.IntentSender;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.common.api.Status;
import com.google.android.gms.common.internal.safeparcel.SafeParcelableSerializer;

import java.util.ArrayList;
import java.util.List;

/**
 * Autorização do Google Drive para o aplicativo, sem ID token e sem cliente "web": usa a API de
 * Autorização do Google Play Services, que só depende do cliente OAuth "Android" (pacote + SHA-1)
 * cadastrado no projeto do Google Cloud. Devolve o token de acesso e o e-mail da conta escolhida.
 *
 * autorizar({ escopos: string[], conta?: string }) -> { accessToken, email, escopos }
 *   - sem concessão anterior, abre a tela de consentimento do Google (e o seletor de contas);
 *   - com concessão anterior, devolve um token novo sem interação (renovação silenciosa).
 */
@CapacitorPlugin(name = "RoniDriveAuth", requestCodes = { RoniDriveAuthPlugin.PEDIDO_CONSENTIMENTO })
public class RoniDriveAuthPlugin extends Plugin {
    static final int PEDIDO_CONSENTIMENTO = 9741;
    private PluginCall chamadaPendente;

    @PluginMethod
    public void autorizar(PluginCall call) {
        JSArray escopos = call.getArray("escopos");
        if (escopos == null || escopos.length() == 0) {
            call.reject("Informe os escopos.", "escopos_ausentes");
            return;
        }
        List<Scope> lista = new ArrayList<>();
        try {
            for (int i = 0; i < escopos.length(); i++) {
                lista.add(new Scope(escopos.getString(i)));
            }
        } catch (Exception e) {
            call.reject("Escopos inválidos.", "escopos_invalidos");
            return;
        }
        AuthorizationRequest.Builder pedido = AuthorizationRequest.builder().setRequestedScopes(lista);
        String conta = call.getString("conta");
        if (conta != null && !conta.isEmpty()) {
            pedido.setAccount(new Account(conta, "com.google"));
        }
        Identity.getAuthorizationClient(getActivity())
            .authorize(pedido.build())
            .addOnSuccessListener(resultado -> aoAutorizar(call, resultado))
            .addOnFailureListener(erro -> rejeitar(call, erro));
    }

    private void aoAutorizar(PluginCall call, AuthorizationResult resultado) {
        if (resultado.hasResolution()) {
            // Primeira vez (ou concessão revogada): o Google mostra o consentimento.
            try {
                chamadaPendente = call;
                saveCall(call);
                IntentSender destino = resultado.getPendingIntent().getIntentSender();
                getActivity().startIntentSenderForResult(destino, PEDIDO_CONSENTIMENTO, null, 0, 0, 0);
            } catch (IntentSender.SendIntentException e) {
                chamadaPendente = null;
                call.reject("Não foi possível abrir a tela de consentimento.", "consentimento_falhou");
            }
            return;
        }
        responder(call, resultado);
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);
        if (requestCode != PEDIDO_CONSENTIMENTO) return;
        PluginCall call = getSavedCall();
        if (call == null) call = chamadaPendente;
        chamadaPendente = null;
        if (call == null) return;
        if (getSavedCall() != null) freeSavedCall();
        if (resultCode != Activity.RESULT_OK || data == null) {
            // Detalhe do que o Google devolveu (status/extras), para diagnóstico.
            String codigo = "negado";
            StringBuilder extras = new StringBuilder();
            if (data != null && data.hasExtra("status")) {
                try {
                    byte[] bytes = data.getByteArrayExtra("status");
                    Status st = SafeParcelableSerializer.deserializeFromBytes(bytes, Status.CREATOR);
                    extras.append("status=").append(st.getStatusCode()).append(" ")
                        .append(st.getStatusMessage());
                    // 16 = CANCELED (usuário), demais: erro do Google (ex.: 10 = cadastro do app)
                    if (st.getStatusCode() != 16) codigo = String.valueOf(st.getStatusCode());
                } catch (Exception e) {
                    extras.append("status ilegível");
                }
            }
            call.reject("O acesso ao Drive não foi autorizado (resultado " + resultCode + "). " + extras,
                codigo);
            return;
        }
        try {
            AuthorizationResult resultado =
                Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(data);
            responder(call, resultado);
        } catch (ApiException e) {
            rejeitar(call, e);
        }
    }

    private void responder(PluginCall call, AuthorizationResult resultado) {
        String token = resultado.getAccessToken();
        if (token == null) {
            call.reject("O Google não devolveu o token de acesso.", "sem_token");
            return;
        }
        JSObject saida = new JSObject();
        saida.put("accessToken", token);
        String email = null;
        if (resultado.toGoogleSignInAccount() != null) {
            email = resultado.toGoogleSignInAccount().getEmail();
        }
        saida.put("email", email);
        JSArray concedidos = new JSArray();
        for (String s : resultado.getGrantedScopes()) concedidos.put(s);
        saida.put("escopos", concedidos);
        call.resolve(saida);
    }

    private void rejeitar(PluginCall call, Exception erro) {
        int codigo = (erro instanceof ApiException) ? ((ApiException) erro).getStatusCode() : -1;
        // 10 = DEVELOPER_ERROR: o pacote + SHA-1 não estão cadastrados no projeto do Google Cloud.
        call.reject("Falha na autorização do Google (" + codigo + "): " + erro.getMessage(),
            String.valueOf(codigo));
    }
}
