import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateHistoricoAlunosTurmasLogsTable1774200000000 implements MigrationInterface {
    name = 'CreateHistoricoAlunosTurmasLogsTable1774200000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "historico_alunos_turmas_logs" (
                "criado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "deletado_em" TIMESTAMP,
                "criado_por" integer,
                "atualizado_por" integer,
                "id" BIGSERIAL NOT NULL,
                "id_turma_aluno" bigint NOT NULL,
                "id_turma" integer NOT NULL,
                "id_aluno" bigint NOT NULL,
                "tipo_acao" character varying(50) NOT NULL,
                "titulo" character varying(255) NOT NULL,
                "descricao" text,
                "template_key" character varying(100),
                "detalhes" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "data_acao" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "pk_historico_alunos_turmas_logs" PRIMARY KEY ("id"),
                CONSTRAINT "fk_historico_alunos_turmas_logs_turma_aluno" FOREIGN KEY ("id_turma_aluno") REFERENCES "turmas_alunos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
                CONSTRAINT "fk_historico_alunos_turmas_logs_turma" FOREIGN KEY ("id_turma") REFERENCES "turmas"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
                CONSTRAINT "fk_historico_alunos_turmas_logs_aluno" FOREIGN KEY ("id_aluno") REFERENCES "alunos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
            )
        `);

        await queryRunner.query(`
            CREATE INDEX "idx_hist_aluno_turma_logs_turma_aluno_data"
            ON "historico_alunos_turmas_logs" ("id_turma_aluno", "data_acao" DESC)
        `);

        await queryRunner.query(`
            CREATE INDEX "idx_hist_aluno_turma_logs_aluno_turma"
            ON "historico_alunos_turmas_logs" ("id_aluno", "id_turma")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_hist_aluno_turma_logs_aluno_turma"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_hist_aluno_turma_logs_turma_aluno_data"`);
        await queryRunner.query(`DROP TABLE "historico_alunos_turmas_logs"`);
    }
}
