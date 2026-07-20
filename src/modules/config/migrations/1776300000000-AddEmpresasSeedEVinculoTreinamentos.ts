import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cria a tabela `empresas` (IAM e Liberty), a coluna `treinamentos.id_empresa`
 * e faz o backfill inicial do vínculo treinamento→empresa: treinamentos cujo
 * nome casa com os produtos da marca Liberty (mesma heurística de
 * `contract-destination-profile.ts` / etiquetas) vão para Liberty; os demais
 * para IAM. O vínculo fica ajustável depois pela tela de cadastro de empresas.
 *
 * A tabela/coluna também são gerenciadas pelas entities (synchronize); a
 * migration garante a existência em ambientes sem synchronize e semeia os
 * registros iniciais. Todas as operações são idempotentes.
 */
export class AddEmpresasSeedEVinculoTreinamentos1776300000000 implements MigrationInterface {
    name = 'AddEmpresasSeedEVinculoTreinamentos1776300000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "empresas" (
                "id" SERIAL NOT NULL,
                "nome" character varying NOT NULL,
                "sigla" character varying,
                "url_logo" text,
                "criado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "deletado_em" TIMESTAMP,
                "criado_por" integer,
                "atualizado_por" integer,
                CONSTRAINT "pk_empresas" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "uq_empresas_nome" ON "empresas" ("nome")
        `);

        await queryRunner.query(`
            ALTER TABLE "treinamentos" ADD COLUMN IF NOT EXISTS "id_empresa" integer
        `);

        // Semeia as duas empresas do grupo (não sobrescreve se já existirem).
        await queryRunner.query(`
            INSERT INTO "empresas" ("nome", "sigla")
            VALUES ('IAM', 'IAM'), ('Liberty', 'LIB')
            ON CONFLICT ("nome") DO NOTHING
        `);

        // Backfill: produtos da marca Liberty (heurística por nome, sem depender
        // da extensão unaccent — TRANSLATE remove os acentos relevantes).
        await queryRunner.query(`
            UPDATE "treinamentos" t
            SET "id_empresa" = (SELECT e."id" FROM "empresas" e WHERE e."nome" = 'Liberty')
            WHERE t."id_empresa" IS NULL
              AND (
                LOWER(TRANSLATE(t."treinamento", 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
                                                 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'))
                LIKE ANY (ARRAY[
                    '%liberty%',
                    '%imersao de negocios%',
                    '%legacy xp%',
                    '%mesa de destino%',
                    '%porsche%',
                    '%lider xp%'
                ])
              )
        `);

        // Demais treinamentos sem vínculo ficam na IAM.
        await queryRunner.query(`
            UPDATE "treinamentos" t
            SET "id_empresa" = (SELECT e."id" FROM "empresas" e WHERE e."nome" = 'IAM')
            WHERE t."id_empresa" IS NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "treinamentos" DROP COLUMN IF EXISTS "id_empresa"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "empresas"`);
    }
}
