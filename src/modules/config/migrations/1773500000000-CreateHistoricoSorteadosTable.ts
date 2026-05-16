import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateHistoricoSorteadosTable1773500000000 implements MigrationInterface {
    name = 'CreateHistoricoSorteadosTable1773500000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "historico_sorteados" (
                "criado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "deletado_em" TIMESTAMP,
                "criado_por" integer,
                "atualizado_por" integer,
                "id" BIGSERIAL NOT NULL,
                "id_turma_aluno" bigint NOT NULL,
                "id_turma" integer NOT NULL,
                "id_presente_sorteio" integer NOT NULL,
                "numero_cracha" character varying NOT NULL,
                "sorteado_em" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "pk_historico_sorteados" PRIMARY KEY ("id"),
                CONSTRAINT "fk_historico_sorteados_turma_aluno" FOREIGN KEY ("id_turma_aluno") REFERENCES "turmas_alunos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
                CONSTRAINT "fk_historico_sorteados_turma" FOREIGN KEY ("id_turma") REFERENCES "turmas"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
                CONSTRAINT "fk_historico_sorteados_presente" FOREIGN KEY ("id_presente_sorteio") REFERENCES "presentes_sorteio"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "historico_sorteados"`);
    }
}
