import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill de logs CRIACAO em `historico_alunos_turmas_logs` para matrículas que foram criadas
 * sem registrar o histórico (ex.: importações de planilha de Masterclass/Time de Vendas), de modo
 * que apareçam como ENTRADA no extrato de movimentação de turmas.
 *
 * Regras:
 * - Apenas matrículas ativas (deletado_em IS NULL).
 * - Idempotente: ignora quem já tem um log CRIACAO.
 * - Pula matrículas que são transferência entre turmas (existe historico_transferencias com
 *   id_turma_de <> id_turma_para), pois essas já contam como "Transferência" (evita dupla contagem).
 * - data_acao = criado_em da matrícula (dia em que o aluno entrou de fato).
 */
export class BackfillCriacaoLogsImportacao1775600000000 implements MigrationInterface {
    name = 'BackfillCriacaoLogsImportacao1775600000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            INSERT INTO historico_alunos_turmas_logs
                (id_turma_aluno, id_turma, id_aluno, tipo_acao, titulo, descricao, detalhes, data_acao, criado_em, atualizado_em)
            SELECT
                ta.id,
                ta.id_turma,
                ta.id_aluno,
                'CRIACAO',
                'Aluno inscrito na turma',
                'Matrícula registrada por backfill (importação sem histórico).',
                '{}'::jsonb,
                ta.criado_em,
                now(),
                now()
            FROM turmas_alunos ta
            WHERE ta.deletado_em IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM historico_alunos_turmas_logs h
                  WHERE h.id_turma_aluno = ta.id
                    AND h.tipo_acao = 'CRIACAO'
                    AND h.deletado_em IS NULL
              )
              AND NOT EXISTS (
                  SELECT 1 FROM historico_transferencias_alunos t
                  WHERE t.id_turma_aluno_para = ta.id
                    AND t.id_turma_de <> t.id_turma_para
                    AND t.deletado_em IS NULL
              )
        `);
    }

    public async down(): Promise<void> {
        // Backfill de dados: sem reversão automática (não dá para distinguir os logs criados
        // pelo backfill dos logs CRIACAO legítimos).
    }
}
