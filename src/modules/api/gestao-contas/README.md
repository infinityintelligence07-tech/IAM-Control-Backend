# Integração IAM Control ↔ Gestão de Contas

Integração com o app **Gestão de Contas** (`gestaocontasiam.lovable.app`, projeto
Supabase `[IAM] Gestão de Contas` / `cbqkoverzdzmhceztldv`).

São dois webhooks, um em cada direção:

| Direção | Endpoint | Quem chama |
| --- | --- | --- |
| Saída (clientes) | `GET /api/webhooks/gestao-contas/clientes` | Gestão de Contas (pull) |
| Entrada (inadimplência) | `POST /api/webhooks/gestao-contas/status` | Gestão de Contas (push) |

Autenticação idêntica à dos demais webhooks (`WebhookTokenGuard`): header
`x-webhook-token`, `Authorization: Bearer <token>` ou query `?token=`.

## Saída — `GET /clientes`

Query params (todos opcionais): `atualizado_desde`, `page`, `limit` (máx. 500),
`id_polo`, `somente_inadimplentes`.

O recorte incremental de `atualizado_desde` considera alterações no cadastro do
aluno **e** nas suas matrículas/vendas — uma venda alterada aparece mesmo sem o
cadastro ter sido tocado. Guarde o `sincronizado_ate` da resposta e devolva-o
como `atualizado_desde` na chamada seguinte.

Cada cliente traz `chave_dedupe` com telefone, e-mail e nome já normalizados
pelas mesmas regras de `identidade-cliente.ts`, para o outro lado conferir sem
reimplementar a normalização.

## Entrada — `POST /status`

```json
{
  "itens": [
    {
      "iam_control_aluno_id": 1747,
      "gestao_contas_student_id": "uuid-do-student",
      "nome": "Flavia Goncalves",
      "email": "flavia@example.com",
      "telefone": "+55 (19) 99477-5851",
      "status": "Inadimplente",
      "inadimplente": true,
      "valor_pendente": 13900,
      "parcelas_pagas": 0,
      "parcelas_totais": 12
    }
  ]
}
```

Máximo de 500 itens por requisição. A resposta traz um `detalhes[]` por item com
`resultado` (`atualizado`, `sem_alteracao`, `nao_encontrado`, `ambiguo`, `erro`),
`casado_por` e o que foi aplicado.

### Como o aluno é localizado

1. `iam_control_aluno_id`, quando enviado.
2. Conferência por identidade: telefone vale 2 pontos, e-mail 2 e nome 1, com
   corte em 3. Ou seja, sempre exige dois sinais independentes — nome igual
   sozinho nunca casa, o que evita fundir homônimos.

Empate na melhor pontuação devolve `ambiguo` e **nada é alterado**. Nesse caso o
item precisa ser reenviado com `iam_control_aluno_id`.

### O que é alterado

- `alunos.status_aluno_geral`
- `turmas_alunos.pendencia_pagamento` das matrículas não canceladas

Um rótulo em `status` é sempre respeitado. Quando a decisão vem só do booleano
`inadimplente`, a única transição automática é INADIMPLENTE ⇄ ATIVO: quitar a
dívida limpa a inadimplência, mas não promove cadastro `PENDENTE` nem reativa
quem foi cancelado ou suspenso aqui dentro.

## Lado da Gestão de Contas (Supabase)

Objetos criados no projeto `cbqkoverzdzmhceztldv`:

- `students.iam_control_aluno_id` (índice único parcial) e `students.iam_control_synced_at`
- `iam_normalize_phone` / `iam_normalize_email` / `iam_normalize_name` — mesma
  normalização do TypeScript, com índices de apoio em `students`
- `iam_control_upsert_student(jsonb)` — upsert com o dedupe descrito acima
- `iam_control_sync_state` — marca d'água do sync incremental
- Edge Function `iam-control-pull-clientes` — consome `GET /clientes`
- Edge Function `iam-control-push-status` — alimenta `POST /status`

Em cadastros já existentes o IAM Control só é dono de identidade, contato e
endereço. Campos operacionais da Gestão de Contas (status, parcelas, AC, tags)
nunca são sobrescritos; `product`, `enrollment_date` e `sale_value` são
preenchidos apenas quando ainda estão vazios.

### Secrets das Edge Functions

| Secret | Valor |
| --- | --- |
| `IAM_CONTROL_API_URL` | `https://iamcontrol.com.br/api` (default do código) |
| `IAM_CONTROL_WEBHOOK_TOKEN` | mesmo token de `webhook-token.guard.ts` |
