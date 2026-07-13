# Auditoria de bônus — vendas do IPR 223 → turma IPR 226

Data da auditoria: 13/07/2026 · Banco: db_iam_control (consultas somente leitura via DBeaver)
Turma origem: IPR **223** (id 68, evento 03/07/2026) · Turma bônus: IPR **226** — Americana (id 71, 07–09/08/2026)

## Resumo da conta

| Métrica | Valor |
|---|---|
| Contratos ativos com origem no IPR 223 | 23 (31 no total, 8 excluídos) |
| Contratos ativos com bônus definido para a 226 | **20** (19 compradores únicos — Fabio tem 2 contratos ativos) |
| Bônus ativos na turma 226 vindos dessas vendas | **95** ✅ (bate com a sua contagem) |
| Bônus ativos na turma 226 no total (todas as origens) | 152 |

Os 95 localizados = **18 compradores com 5 bônus cada** (todos OK) **+ 5 da Dinalva** (contrato excluído, bônus ficaram) **– 5 do Rafael** (bônus removidos, contrato ficou).

## Os 4 casos que explicam a diferença (105 − 95 = 10)

### 1. Rafael Hilário de Moraes Soares — 5 bônus FALTANDO de verdade ⚠️
- Contrato **c#614** (04/07 13:28) está **ativo**, com bônus "5 inscrições na 226" definido.
- Os 5 bônus (crachás 01305–01309) foram criados em 04/07 13:28 e **removidos manualmente em 12/07/2026 às 19:12 pela usuária Jociléia Paiano Santos** (log: "Matrícula removida manualmente", sem motivo registrado).
- Se a remoção foi indevida, é preciso recriar os 5 bônus dele na 226.

### 2. Fabio José Trevizan Silva — venda DUPLICADA no Histórico (5 "esperados" que não existem)
- A mesma venda (mesma matrícula/treinamento, tat=601) tem **2 contratos ativos**: **c#618** (04/07 14:09) e **c#697** (13/07 14:07, refeito hoje).
- Hoje o fluxo foi: c#696 criado 13:49 (com 4 inscrições) → excluído → c#697 criado 14:07 (com 5). O **c#618 antigo ficou ativo por engano**.
- Os 5 bônus dele **existem e estão corretos**. Mas se você conta o Histórico por contrato, essa venda aparece 2× (10 esperados em vez de 5).
- Sugestão: excluir o contrato c#618 (o de 04/07), mantendo só o c#697.

### 3. Dinalva de Oliveira — contrato excluído, bônus ficaram
- Contrato **c#610** (04/07 12:40) foi **excluído** em 04/07, mas os **5 bônus dela continuam ativos** na 226 (estão dentro dos seus 95).
- Comportamento esperado do sistema atual: excluir contrato não remove matrículas/bônus (fica para avaliação manual do Cuidado de Alunos).
- Decidir: se a venda vale (contrato será refeito, como foi feito hoje com Rodrigo/Milena/Priscila), está tudo certo; se a venda caiu, os 5 bônus dela deveriam ser removidos.

### 4. Thais Helena Machado Peressim — venda sem NENHUM bônus registrado
- Contrato **c#623** (05/07 10:07, CONF) está ativo, mas **sem nenhuma turma de bônus IPR definida** (sem vínculo de bônus, sem "Turmas do Imersão Prosperar" no contrato).
- Todas as outras vendas de CONF desse evento tiveram 5 bônus para a 226. Se a dela também devia ter, **os 5 nunca foram criados** — seria preciso editar a venda e incluir o bônus.

## Fechando a sua conta de 21 vendas × 5 = 105

- 5 faltantes são certos: **Rafael** (removidos manualmente em 12/07).
- Os outros 5 dependem de qual é a 21ª venda da sua lista:
  - Se você contou a **Thais**, faltam os 5 dela (nunca criados).
  - Se você contou o **Fabio 2×** (como o Histórico mostra hoje), esses 5 "extras" nunca existiram — é uma venda só, duplicada por engano.
  - A **Dinalva** já está dentro dos 95 encontrados, apesar de o contrato dela ter sido excluído.

## Compradores × bônus ativos na 226

| Comprador | Contrato(s) | Esperado | Ativos | Situação |
|---|---|---|---|---|
| Angela Inacio S Sampaio | c#626 | 5 | 5 | OK |
| Camila Francisco Bonfim Silva | c#631 | 5 | 5 | OK |
| Cintia Maria Soares Trevizan | c#617 | 5 | 5 | OK |
| Daniela Atanasio | c#622 | 5 | 5 | OK |
| Deborah Santana da Silva | c#630 | 5 | 5 | OK |
| Érika Ogura | c#628 | 5 | 5 | OK |
| Fabio José Trevizan Silva | c#618 + c#697 (duplicado) | 5 (não 10) | 5 | Contrato duplicado |
| Flávia Góes Rodrigues | c#620 | 5 | 5 | OK |
| Gabriela Fonseca de Souza | c#615 | 5 | 5 | OK |
| Lucas Gabriel Ramos da Silva | c#613 | 5 | 5 | OK |
| Luis Guilherme Astun Guedine | c#612 | 5 | 5 | OK |
| Luís Henrique da Silva | c#629 | 5 | 5 | OK |
| Maria Eduarda Calixto | c#632 | 5 | 5 | OK |
| Matheus Batista dos Santos | c#611 | 5 | 5 | OK |
| Milena Goes Rodrigues | c#695 | 5 | 5 | OK |
| Priscila Regina de O. Marques | c#699 | 5 | 5 | OK |
| Rodrigo de Oliveira | c#700 | 5 | 5 | OK |
| Silvana da Silva Perosa | c#624 | 5 | 5 | OK |
| **Rafael Hilário de M. Soares** | c#614 (ativo) | 5 | **0** | **Removidos em 12/07 19:12 (Jociléia)** |
| Dinalva de Oliveira | c#610 (excluído) | — | 5 | Bônus ficaram sem contrato |
| Thais Helena M. Peressim | c#623 (sem bônus) | 0 registrado | 0 | Bônus nunca definidos na venda |

Obs.: as demais vendas do IPR 223 sem bônus para a 226 (Marcos Atanasio, Milene Moreau/PNL etc.) não entram nessa conta. Os outros 57 bônus ativos na 226 vêm de vendas de outros eventos (Michel Biller, José de Lima Brito, Gabriel Henrique etc.) e não afetam a sua contagem.

## Ações sugeridas

1. Recriar os 5 bônus do Rafael na 226 (ou confirmar com a Jociléia o motivo da remoção antes).
2. Excluir o contrato duplicado c#618 do Fabio (mantendo o c#697).
3. Se a venda da Thais tinha bônus, editar a venda e incluir as 5 inscrições da 226.
4. Decidir o caso Dinalva: refazer o contrato ou remover os 5 bônus dela.

---
*Ferramentas deixadas no repositório para reauditar quando quiser: `IAM-Control-Backend/scripts/audit-bonus-ipr226.js` (rode com `node scripts/audit-bonus-ipr226.js`, ou dê 2 cliques em `scripts/run-audit.cmd`) — gera um JSON completo com essa mesma análise.*
