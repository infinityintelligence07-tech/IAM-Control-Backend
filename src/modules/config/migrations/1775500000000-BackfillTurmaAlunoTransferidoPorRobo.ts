import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill da coluna `transferido_por_robo`: marca as matrículas de DESTINO que foram
 * geradas pela auto-transferência por no-show IPR (robô), identificadas pelos logs já
 * existentes em `historico_alunos_turmas_logs` com `template_key` =
 * 'AUTO_TRANSFERENCIA_NO_SHOW_IPR`. É idempotente (só marca quem ainda está como false).
 */
export class BackfillTurmaAlunoTransferidoPorRobo1775500000000 implements MigrationInterface {
    name = 'BackfillTurmaAlunoTransferidoPorRobo1775500000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE turmas_alunos ta
            SET transferido_por_robo = true
            FROM historico_alunos_turmas_logs h
            WHERE h.template_key = 'AUTO_TRANSFERENCIA_NO_SHOW_IPR'
              AND h.deletado_em IS NULL
              AND ta.id_aluno = h.id_aluno
              AND ta.id_turma = (h.detalhes->>'id_turma_destino')::int
              AND ta.origem_aluno = 'TRANSFERENCIA'
              AND COALESCE(ta.transferido_por_robo, false) = false
        `);
    }

    public async down(): Promise<void> {
        // Backfill de dados: sem reversão automática (não dá para distinguir os marcados pelo backfill
        // dos marcados em novas auto-transferências).
    }
}
