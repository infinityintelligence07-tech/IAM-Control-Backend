import { MigrationInterface, QueryRunner } from 'typeorm';

export class EStatusAlunosTurmasConfirmacao1768163181025 implements MigrationInterface {
    name = 'EStatusAlunosTurmasConfirmacao1768163181025';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TYPE "public"."EStatusAlunosTurmas" ADD VALUE IF NOT EXISTS 'AGUARDANDO_CONFIRMACAO'`,
        );
        await queryRunner.query(
            `ALTER TYPE "public"."EStatusAlunosTurmas" ADD VALUE IF NOT EXISTS 'FALTA_ENVIAR_LINK_CONFIRMACAO'`,
        );
        await queryRunner.query(
            `UPDATE "turmas_alunos" SET "status_aluno_turma" = 'FALTA_ENVIAR_LINK_CONFIRMACAO' WHERE "status_aluno_turma" = 'FALTA_ENVIAR_LINK_CHECKIN'`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "turmas_alunos" SET "status_aluno_turma" = 'FALTA_ENVIAR_LINK_CHECKIN' WHERE "status_aluno_turma" = 'FALTA_ENVIAR_LINK_CONFIRMACAO'`,
        );
        // PostgreSQL não permite remover valores de enum de forma simples
    }
}
