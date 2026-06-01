import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterImageFieldsToText1774400000000 implements MigrationInterface {
    name = 'AlterImageFieldsToText1774400000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "alunos"
            ALTER COLUMN "url_foto_aluno" TYPE text
        `);

        await queryRunner.query(`
            ALTER TABLE "treinamentos"
            ALTER COLUMN "url_logo_treinamento" TYPE text
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "treinamentos"
            ALTER COLUMN "url_logo_treinamento" TYPE character varying
        `);

        await queryRunner.query(`
            ALTER TABLE "alunos"
            ALTER COLUMN "url_foto_aluno" TYPE character varying
        `);
    }
}
