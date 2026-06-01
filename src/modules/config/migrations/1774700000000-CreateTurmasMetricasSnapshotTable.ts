import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTurmasMetricasSnapshotTable1774700000000 implements MigrationInterface {
    name = 'CreateTurmasMetricasSnapshotTable1774700000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "turmas_metricas_snapshot" (
                "criado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "deletado_em" TIMESTAMP,
                "criado_por" integer,
                "atualizado_por" integer,
                "id" BIGSERIAL NOT NULL,
                "id_turma" integer NOT NULL,
                "snapshot_em" TIMESTAMP NOT NULL DEFAULT now(),
                "resumo" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "alunos_por_tipo" jsonb NOT NULL DEFAULT '{}'::jsonb,
                CONSTRAINT "pk_turmas_metricas_snapshot" PRIMARY KEY ("id"),
                CONSTRAINT "uq_turmas_metricas_snapshot_turma" UNIQUE ("id_turma"),
                CONSTRAINT "fk_turmas_metricas_snapshot_turma" FOREIGN KEY ("id_turma") REFERENCES "turmas"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
            )
        `);

        await queryRunner.query(`
            CREATE INDEX "idx_turmas_metricas_snapshot_id_turma"
            ON "turmas_metricas_snapshot" ("id_turma")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_turmas_metricas_snapshot_id_turma"`);
        await queryRunner.query(`DROP TABLE "turmas_metricas_snapshot"`);
    }
}
