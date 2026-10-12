# Testes de contrato da API

Cada arquivo `*.json` descreve um cenário: uma sequência de requisições ao roteador do núcleo e o
que se espera de cada resposta. Os mesmos arquivos são executados em dois lugares:

| Execução | Executor |
|---|---|
| Núcleo com repositório em memória | `nucleo/test/contrato.test.js` |
| Modo do aparelho (banco local, ambiente determinístico, transporte local) | `jstests/contrato_local.test.js` |

No modo do aparelho o encerramento não gera o PDF na hora (o documento é gerado depois, pelo
Drive); por isso `documento`/`hash_sha256` do encerramento e a verificação são ajustados no
executor.

## Formato

```json
{
  "nome": "descrição do cenário",
  "passos": [
    {
      "como": "sec@c.com",                  // usuário (null = sem credencial)
      "metodo": "POST",
      "caminho": "/api/tutores/{idTutor}",  // {var} é trocado pelo valor guardado
      "corpo": { "tutor_id": "@idTutor" },  // "@var" (string inteira) é trocado pelo valor guardado
      "espera": { "status": 201, "corpo": { "nome": "Maria" } },
      "guardar": { "idTutor": "id" }        // variável -> caminho no corpo (ex.: "atendimento.id", "0.id")
    }
  ]
}
```

Usuários do contrato: `admin@c.com` (ADMIN), `sec@c.com` (SECRETARIA) e `vet@c.com`
(VETERINARIO, CRMV-SP 123). O tipo `tipo-vacina` já existe.

## Como o corpo esperado é comparado

A comparação é **parcial**: só o que está em `espera.corpo` é conferido.

- objeto: cada chave esperada deve existir e casar;
- lista: mesmo tamanho e cada item casa; ou `{"$tamanho": n}` e/ou `{"$contem": {...}}`;
- `"$qualquer"`: qualquer valor (inclusive nulo); `"$presente"`: não nulo; `"$nulo"`: nulo;
- demais valores: igualdade.

Respostas que não são JSON (PDF, CSV) só têm o status conferido.
