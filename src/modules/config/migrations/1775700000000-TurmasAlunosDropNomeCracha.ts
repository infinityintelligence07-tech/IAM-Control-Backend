import { MigrationInterface, QueryRunner } from 'typeorm';

export class TurmasAlunosDropNomeCracha1775700000000 implements MigrationInterface {
    name = 'TurmasAlunosDropNomeCracha1775700000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // O "como gostaria de ser chamado" passa a viver exclusivamente no cadastro do aluno (alunos.nome_cracha).
        await queryRunner.query(`ALTER TABLE "turmas_alunos" DROP COLUMN IF EXISTS "nome_cracha"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas_alunos" ADD COLUMN IF NOT EXISTS "nome_cracha" character varying`);
    }
}
