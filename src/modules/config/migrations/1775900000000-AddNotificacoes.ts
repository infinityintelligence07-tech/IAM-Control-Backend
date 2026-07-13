import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cria as tabelas de notificações internas por setor e o registro de leitura
 * por usuário (lidas/não lidas). Idempotente: `synchronize: true` também cria
 * as tabelas no boot, então tudo usa IF NOT EXISTS.
 */
export class AddNotificacoes1775900000000 implements MigrationInterface {
    name = 'AddNotificacoes1775900000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "notificacoes" (
                "id" SERIAL NOT NULL,
                "tipo" character varying(60) NOT NULL,
                "titulo" character varying(255) NOT NULL,
                "mensagem" text NOT NULL,
                "setor_destino" character varying(60) NOT NULL,
                "dados" jsonb,
                "criado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "deletado_em" TIMESTAMP,
                "criado_por" integer,
                "atualizado_por" integer,
                CONSTRAINT "pk_notificacoes" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_notificacoes_setor_destino" ON "notificacoes" ("setor_destino")`,
        );

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "notificacoes_leituras" (
                "id" SERIAL NOT NULL,
                "id_notificacao" integer NOT NULL,
                "id_usuario" integer NOT NULL,
                "criado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "deletado_em" TIMESTAMP,
                "criado_por" integer,
                "atualizado_por" integer,
                CONSTRAINT "pk_notificacoes_leituras" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "uq_notificacoes_leituras_notificacao_usuario" ON "notificacoes_leituras" ("id_notificacao", "id_usuario")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "idx_notificacoes_leituras_usuario" ON "notificacoes_leituras" ("id_usuario")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "notificacoes_leituras"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "notificacoes"`);
    }
}
