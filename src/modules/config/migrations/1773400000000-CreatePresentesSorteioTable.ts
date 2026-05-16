import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePresentesSorteioTable1773400000000 implements MigrationInterface {
    name = 'CreatePresentesSorteioTable1773400000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "presentes_sorteio" (
                "criado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "deletado_em" TIMESTAMP,
                "criado_por" integer,
                "atualizado_por" integer,
                "id" SERIAL NOT NULL,
                "descricao" character varying NOT NULL,
                "imagem_url" character varying,
                "para_toda_turma" boolean NOT NULL DEFAULT true,
                CONSTRAINT "pk_presentes_sorteio" PRIMARY KEY ("id")
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "presentes_sorteio"`);
    }
}
