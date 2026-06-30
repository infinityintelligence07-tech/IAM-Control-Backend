import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cria a tabela `configuracoes_sistema` (chave/valor) e semeia as variáveis
 * padrão usadas pelo sistema. Atualmente guarda os contatos padrão das
 * testemunhas dos contratos (e-mail e telefone), editáveis pela tela de
 * Configurações.
 *
 * A tabela também é gerenciada pela entity (synchronize), mas a migration
 * garante a existência em ambientes sem synchronize e cria os registros
 * iniciais para que as variáveis já existam no banco prontas para edição.
 * Todas as operações são idempotentes.
 */
export class AddConfiguracoesSistema1775400000000 implements MigrationInterface {
    name = 'AddConfiguracoesSistema1775400000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "configuracoes_sistema" (
                "id" SERIAL NOT NULL,
                "chave" character varying(120) NOT NULL,
                "valor" text,
                "descricao" character varying(255),
                "criado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(),
                "deletado_em" TIMESTAMP,
                "criado_por" integer,
                "atualizado_por" integer,
                CONSTRAINT "pk_configuracoes_sistema" PRIMARY KEY ("id")
            )
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "uq_configuracoes_sistema_chave"
            ON "configuracoes_sistema" ("chave")
        `);

        // Semeia as variáveis padrão (não sobrescreve valores já existentes).
        await queryRunner.query(`
            INSERT INTO "configuracoes_sistema" ("chave", "valor", "descricao")
            VALUES
                ('testemunha_email_padrao', 'contato@iamtreinamentos.com.br', 'E-mail padrão das testemunhas dos contratos'),
                ('testemunha_telefone_padrao', '(19) 98317-3941', 'Telefone padrão das testemunhas dos contratos')
            ON CONFLICT ("chave") DO NOTHING
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DELETE FROM "configuracoes_sistema"
            WHERE "chave" IN ('testemunha_email_padrao', 'testemunha_telefone_padrao')
        `);
    }
}
