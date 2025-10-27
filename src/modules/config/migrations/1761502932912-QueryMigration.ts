import { MigrationInterface, QueryRunner } from "typeorm";

export class QueryMigration1761502932912 implements MigrationInterface {
    name = 'QueryMigration1761502932912'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TYPE "public"."EFuncoes" RENAME TO "EFuncoes_old"`);
        await queryRunner.query(`CREATE TYPE "public"."EFuncoes" AS ENUM('ADMINISTRADOR', 'ADVOGADO', 'COLABORADOR', 'COPYWRITER', 'DESENVOLVEDOR', 'DESIGNER_GRAFICO', 'DJ', 'EDICAO_DE_VIDEO', 'ESTAGIARIO', 'FOTOGRAFO', 'INSIDE_SALES', 'LIDER', 'LIDER_DE_CONFRONTO', 'LIDER_DE_MASTERCLASS', 'LIDER_DE_EVENTOS', 'LOGISTICA', 'PALESTRANTE', 'RELACIONAMENTO_COM_CLIENTES', 'RH', 'SOCIAL_MEDIA', 'SOCIAL_SELLING', 'STAFF', 'TRAEGO_DIGITAL', 'TUTOR_MISSAO', 'VENDEDOR', 'WEB_DESIGNER')`);
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "funcao" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "funcao" TYPE "public"."EFuncoes" USING "funcao"::"text"::"public"."EFuncoes"`);
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "funcao" SET DEFAULT 'COLABORADOR'`);
        await queryRunner.query(`DROP TYPE "public"."EFuncoes_old"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."EFuncoes_old" AS ENUM('ADMINISTRADOR', 'ADVOGADO', 'COLABORADOR', 'COPYWRITER', 'DESENVOLVEDOR', 'DESIGNER_GRAFICO', 'DJ', 'ESTAGIARIO', 'FOTOGRAFO', 'INSIDE_SALES', 'LIDER', 'LIDER_DE_CONFRONTO', 'LIDER_DE_MASTERCLASS', 'LIDER_DE_EVENTOS', 'PALESTRANTE', 'RELACIONAMENTO_COM_CLIENTES', 'RH', 'SOCIAL_MEDIA', 'SOCIAL_SELLING', 'STAFF', 'TRAEGO_DIGITAL', 'TUTOR_MISSAO', 'VENDEDOR', 'WEB_DESIGNER')`);
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "funcao" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "funcao" TYPE "public"."EFuncoes_old" USING "funcao"::"text"::"public"."EFuncoes_old"`);
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "funcao" SET DEFAULT 'COLABORADOR'`);
        await queryRunner.query(`DROP TYPE "public"."EFuncoes"`);
        await queryRunner.query(`ALTER TYPE "public"."EFuncoes_old" RENAME TO "EFuncoes"`);
    }

}
