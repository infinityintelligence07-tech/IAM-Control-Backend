import { MigrationInterface, QueryRunner } from 'typeorm';

export class QueryMigration1757825851880 implements MigrationInterface {
    name = 'QueryMigration1757825851880';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "treinamentos" ADD "tipo_treinamento" boolean NOT NULL`);
        await queryRunner.query(`ALTER TABLE "treinamentos" ADD "tipo_palestra" boolean NOT NULL`);
        await queryRunner.query(`ALTER TABLE "treinamentos" ADD "tipo_online" boolean NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "treinamentos" DROP COLUMN "tipo_online"`);
        await queryRunner.query(`ALTER TABLE "treinamentos" DROP COLUMN "tipo_palestra"`);
        await queryRunner.query(`ALTER TABLE "treinamentos" DROP COLUMN "tipo_treinamento"`);
    }
}
