import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTurmaDisponibilidadeTable1777100000000 implements MigrationInterface {
    name = 'CreateTurmaDisponibilidadeTable1777100000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "turma_disponibilidade" (
                "criado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "deletado_em" TIMESTAMP,
                "criado_por" integer,
                "atualizado_por" integer,
                "id" SERIAL NOT NULL,
                "id_turma" integer NOT NULL,
                "data_hora" TIMESTAMP NOT NULL,
                "qtd_manha" integer NOT NULL DEFAULT 0,
                "qtd_tarde" integer NOT NULL DEFAULT 0,
                "qtd_noite" integer NOT NULL DEFAULT 0,
                "qtd_fila_pitch" integer NOT NULL DEFAULT 0,
                "qtd_fila_repitch" integer NOT NULL DEFAULT 0,
                "observacao" character varying,
                CONSTRAINT "pk_turma_disponibilidade" PRIMARY KEY ("id"),
                CONSTRAINT "fk_turma_disponibilidade_turma" FOREIGN KEY ("id_turma") REFERENCES "turmas"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
            )
        `);

        await queryRunner.query(`
            CREATE INDEX "idx_turma_disponibilidade_id_turma"
            ON "turma_disponibilidade" ("id_turma")
        `);

        await queryRunner.query(`
            CREATE INDEX "idx_turma_disponibilidade_data_hora"
            ON "turma_disponibilidade" ("data_hora")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "idx_turma_disponibilidade_data_hora"`);
        await queryRunner.query(`DROP INDEX "idx_turma_disponibilidade_id_turma"`);
        await queryRunner.query(`DROP TABLE "turma_disponibilidade"`);
    }
}
