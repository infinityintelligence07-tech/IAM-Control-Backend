import { MigrationInterface, QueryRunner } from 'typeorm';

export class TransferenciaAlunosTurmas1768163181023 implements MigrationInterface {
    name = 'TransferenciaAlunosTurmas1768163181023';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "turmas_alunos" ADD COLUMN IF NOT EXISTS "id_turma_transferencia_para" integer`,
        );
        await queryRunner.query(
            `ALTER TABLE "turmas_alunos" ADD COLUMN IF NOT EXISTS "id_turma_transferencia_de" integer`,
        );
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "historico_transferencias_alunos" (
                "id" BIGSERIAL NOT NULL,
                "criado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "deletado_em" TIMESTAMP,
                "criado_por" integer,
                "atualizado_por" integer,
                "id_aluno" integer NOT NULL,
                "id_turma_de" integer NOT NULL,
                "id_turma_para" integer NOT NULL,
                "id_turma_aluno_de" bigint,
                "id_turma_aluno_para" bigint,
                CONSTRAINT "pk_historico_transferencias_alunos" PRIMARY KEY ("id")
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "historico_transferencias_alunos"`);
        await queryRunner.query(
            `ALTER TABLE "turmas_alunos" DROP COLUMN IF EXISTS "id_turma_transferencia_de"`,
        );
        await queryRunner.query(
            `ALTER TABLE "turmas_alunos" DROP COLUMN IF EXISTS "id_turma_transferencia_para"`,
        );
    }
}
