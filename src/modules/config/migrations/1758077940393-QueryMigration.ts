import { MigrationInterface, QueryRunner } from 'typeorm';

export class QueryMigration1758077940393 implements MigrationInterface {
    name = 'QueryMigration1758077940393';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_bonus" DROP CONSTRAINT "FK_906a885dbbe9c8855cd992ae136"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_bonus" DROP COLUMN "id_turma"`);
        await queryRunner.query(`ALTER TABLE "turmas" ADD "detalhamento_bonus" jsonb array`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas" DROP COLUMN "detalhamento_bonus"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_bonus" ADD "id_turma" integer`);
        await queryRunner.query(
            `ALTER TABLE "turmas_alunos_treinamentos_bonus" ADD CONSTRAINT "FK_906a885dbbe9c8855cd992ae136" FOREIGN KEY ("id_turma") REFERENCES "turmas"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
        );
    }
}
