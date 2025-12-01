import { MigrationInterface, QueryRunner } from "typeorm";

export class QueryMigration1763708231556 implements MigrationInterface {
    name = 'QueryMigration1763708231556'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "polos" ("criado_em" TIMESTAMP NOT NULL DEFAULT now(), "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(), "deletado_em" TIMESTAMP, "criado_por" integer, "atualizado_por" integer, "id" SERIAL NOT NULL, "sigla_polo" character varying NOT NULL, "polo" character varying NOT NULL, "cidade" character varying NOT NULL, "estado" character varying NOT NULL, CONSTRAINT "pk_polos" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "alunos" ADD CONSTRAINT "FK_25683226dcf8656489ad2a322a8" FOREIGN KEY ("id_polo") REFERENCES "polos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "turmas" ADD CONSTRAINT "FK_2c68e7bcc1349b310e5a6bbf0f8" FOREIGN KEY ("id_polo") REFERENCES "polos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" DROP CONSTRAINT "FK_2c68e7bcc1349b310e5a6bbf0f8"`);
        await queryRunner.query(`ALTER TABLE "alunos" DROP CONSTRAINT "FK_25683226dcf8656489ad2a322a8"`);
        await queryRunner.query(`DROP TABLE "polos"`);
    }

}
