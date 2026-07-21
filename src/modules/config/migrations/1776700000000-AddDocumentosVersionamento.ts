import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Versionamento dos documentos (modelos de contrato/termo):
 * - adiciona a coluna `versao` em `documentos` (versão vigente, default 1);
 * - cria a tabela `documentos_versoes`, que arquiva o estado anterior do
 *   documento a cada edição/restauração, permitindo histórico e rollback.
 * A FK é gerenciada pela relação ManyToOne da entity (synchronize); aqui
 * garantimos a existência das estruturas em ambientes sem synchronize.
 */
export class AddDocumentosVersionamento1776700000000 implements MigrationInterface {
    name = 'AddDocumentosVersionamento1776700000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "documentos" ADD COLUMN IF NOT EXISTS "versao" integer NOT NULL DEFAULT 1`);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "documentos_versoes" (
                "id" SERIAL NOT NULL,
                "id_documento" integer NOT NULL,
                "versao" integer NOT NULL,
                "documento" character varying,
                "tipo_documento" character varying,
                "campos_documento" jsonb,
                "clausulas" text,
                "treinamentos_relacionados" jsonb,
                "conteudo_alterado_em" TIMESTAMP,
                "conteudo_alterado_por" integer,
                "criado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "deletado_em" TIMESTAMP,
                "criado_por" integer,
                "atualizado_por" integer,
                CONSTRAINT "pk_documentos_versoes" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_documentos_versoes_id_documento" ON "documentos_versoes" ("id_documento")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "documentos_versoes"`);
        await queryRunner.query(`ALTER TABLE "documentos" DROP COLUMN IF EXISTS "versao"`);
    }
}
