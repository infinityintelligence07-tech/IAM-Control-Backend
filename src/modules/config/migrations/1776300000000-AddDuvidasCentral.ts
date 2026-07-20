import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tabelas da Central de Dúvidas: artigos (base Obsidian), conversas/mensagens
 * do agente e fila de sugestões para aprovação admin.
 * Idempotente (IF NOT EXISTS) pois synchronize: true também pode criar no boot.
 */
export class AddDuvidasCentral1776300000000 implements MigrationInterface {
    name = 'AddDuvidasCentral1776300000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "duvidas_artigos" (
                "id" SERIAL NOT NULL,
                "titulo" character varying(500) NOT NULL,
                "slug" character varying(500) NOT NULL,
                "conteudo_md" text NOT NULL,
                "caminho_origem" character varying(1000),
                "status" character varying(20) NOT NULL DEFAULT 'publicado',
                "tags" jsonb,
                "criado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "deletado_em" TIMESTAMP,
                "criado_por" integer,
                "atualizado_por" integer,
                CONSTRAINT "pk_duvidas_artigos" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "uq_duvidas_artigos_slug" ON "duvidas_artigos" ("slug")`,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "uq_duvidas_artigos_caminho_origem" ON "duvidas_artigos" ("caminho_origem") WHERE "caminho_origem" IS NOT NULL`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_duvidas_artigos_status" ON "duvidas_artigos" ("status")`,
        );
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "idx_duvidas_artigos_fts"
            ON "duvidas_artigos"
            USING GIN (to_tsvector('portuguese', coalesce("titulo", '') || ' ' || coalesce("conteudo_md", '')))
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "duvidas_conversas" (
                "id" SERIAL NOT NULL,
                "id_usuario" integer NOT NULL,
                "titulo" character varying(255),
                "criado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "deletado_em" TIMESTAMP,
                "criado_por" integer,
                "atualizado_por" integer,
                CONSTRAINT "pk_duvidas_conversas" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_duvidas_conversas_usuario" ON "duvidas_conversas" ("id_usuario")`,
        );

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "duvidas_mensagens" (
                "id" SERIAL NOT NULL,
                "id_conversa" integer NOT NULL,
                "role" character varying(20) NOT NULL,
                "conteudo" text NOT NULL,
                "fontes" jsonb,
                "lacuna_detectada" boolean NOT NULL DEFAULT false,
                "criado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "deletado_em" TIMESTAMP,
                "criado_por" integer,
                "atualizado_por" integer,
                CONSTRAINT "pk_duvidas_mensagens" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_duvidas_mensagens_conversa" ON "duvidas_mensagens" ("id_conversa")`,
        );

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "duvidas_sugestoes" (
                "id" SERIAL NOT NULL,
                "pergunta" text NOT NULL,
                "resposta_proposta" text NOT NULL,
                "conteudo_md_proposto" text NOT NULL,
                "titulo_proposto" character varying(500),
                "status" character varying(20) NOT NULL DEFAULT 'pendente',
                "id_conversa" integer,
                "id_mensagem" integer,
                "id_artigo" integer,
                "criado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "deletado_em" TIMESTAMP,
                "criado_por" integer,
                "atualizado_por" integer,
                CONSTRAINT "pk_duvidas_sugestoes" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_duvidas_sugestoes_status" ON "duvidas_sugestoes" ("status")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "duvidas_sugestoes"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "duvidas_mensagens"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "duvidas_conversas"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "duvidas_artigos"`);
    }
}
