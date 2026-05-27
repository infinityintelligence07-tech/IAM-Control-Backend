import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConfirmacaoAndCheckinRealizadoToTurmasAlunos1774100000000 implements MigrationInterface {
    name = 'AddConfirmacaoAndCheckinRealizadoToTurmasAlunos1774100000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas_alunos" ADD "confirmacao_realizada" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" ADD "checkin_realizado" boolean NOT NULL DEFAULT false`);

        await queryRunner.query(`
            UPDATE "turmas_alunos"
            SET
                "confirmacao_realizada" = CASE
                    WHEN "status_aluno_turma" IN ('AGUARDANDO_CHECKIN', 'CHECKIN_REALIZADO') THEN true
                    ELSE false
                END,
                "checkin_realizado" = CASE
                    WHEN "status_aluno_turma" = 'CHECKIN_REALIZADO' OR "presenca_turma" = 'PRESENTE' THEN true
                    ELSE false
                END
            WHERE "deletado_em" IS NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas_alunos" DROP COLUMN "checkin_realizado"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" DROP COLUMN "confirmacao_realizada"`);
    }
}
