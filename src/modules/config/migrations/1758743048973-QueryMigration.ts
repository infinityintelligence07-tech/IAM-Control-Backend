import { MigrationInterface, QueryRunner } from 'typeorm';

export class QueryMigration1758743048973 implements MigrationInterface {
    name = 'QueryMigration1758743048973';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."documentos_tipo_documento_enum" AS ENUM('CONTRATO', 'TERMO')`);
        await queryRunner.query(`ALTER TABLE "documentos" ADD "tipo_documento" "public"."documentos_tipo_documento_enum" NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "documentos" DROP COLUMN "tipo_documento"`);
        await queryRunner.query(`DROP TYPE "public"."documentos_tipo_documento_enum"`);
    }
}
