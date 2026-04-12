import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveUniqueEmailFromAlunos1773100000000 implements MigrationInterface {
    name = 'RemoveUniqueEmailFromAlunos1773100000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "alunos" DROP CONSTRAINT IF EXISTS "UQ_1f9a8f3f4e5a314a2d7f828a605"`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "alunos" ADD CONSTRAINT "UQ_1f9a8f3f4e5a314a2d7f828a605" UNIQUE ("email")`,
        );
    }
}
