import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Atualiza registros de FALTA_ENVIAR_LINK_CHECKIN para FALTA_ENVIAR_LINK_CONFIRMACAO.
 * Deve rodar após a migration que adiciona o valor ao enum (para o commit do enum já ter ocorrido).
 */
export class EStatusAlunosTurmasUpdateCheckinToConfirmacao1768163181026 implements MigrationInterface {
    name = 'EStatusAlunosTurmasUpdateCheckinToConfirmacao1768163181026';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "turmas_alunos" SET "status_aluno_turma" = 'FALTA_ENVIAR_LINK_CONFIRMACAO' WHERE "status_aluno_turma" = 'FALTA_ENVIAR_LINK_CHECKIN'`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "turmas_alunos" SET "status_aluno_turma" = 'FALTA_ENVIAR_LINK_CHECKIN' WHERE "status_aluno_turma" = 'FALTA_ENVIAR_LINK_CONFIRMACAO'`,
        );
    }
}
