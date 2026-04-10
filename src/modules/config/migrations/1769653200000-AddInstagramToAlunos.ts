import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInstagramToAlunos1769653200000 implements MigrationInterface {
  name = 'AddInstagramToAlunos1769653200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "alunos" ADD COLUMN IF NOT EXISTS "instagram" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "alunos" DROP COLUMN IF EXISTS "instagram"`,
    );
  }
}
