import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlunosIdPoloNullable1768163181021 implements MigrationInterface {
    name = 'AlunosIdPoloNullable1768163181021';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "alunos" ALTER COLUMN "id_polo" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Só permite reverter se não houver alunos com id_polo NULL
        await queryRunner.query(`ALTER TABLE "alunos" ALTER COLUMN "id_polo" SET NOT NULL`);
    }
}
