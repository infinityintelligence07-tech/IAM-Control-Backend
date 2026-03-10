import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlunosNomeCrachaNullable1768163181022 implements MigrationInterface {
    name = 'AlunosNomeCrachaNullable1768163181022';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "alunos" ALTER COLUMN "nome_cracha" DROP NOT NULL`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "alunos" ALTER COLUMN "nome_cracha" SET NOT NULL`,
        );
    }
}
