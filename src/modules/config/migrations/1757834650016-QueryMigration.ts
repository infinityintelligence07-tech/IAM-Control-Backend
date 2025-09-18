import { MigrationInterface, QueryRunner } from 'typeorm';

export class QueryMigration1757834650016 implements MigrationInterface {
    name = 'QueryMigration1757834650016';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "treinamentos" DROP COLUMN "preco_treinamento"`);
        await queryRunner.query(`ALTER TABLE "treinamentos" ADD "preco_treinamento" double precision NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "treinamentos" DROP COLUMN "preco_treinamento"`);
        await queryRunner.query(`ALTER TABLE "treinamentos" ADD "preco_treinamento" character varying NOT NULL`);
    }
}
