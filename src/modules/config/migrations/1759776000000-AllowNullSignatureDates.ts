import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowNullSignatureDates1759776000000 implements MigrationInterface {
    name = 'AllowNullSignatureDates1759776000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Permitir valores nulos nas colunas de data de assinatura
        // As datas só devem ser preenchidas quando a assinatura for efetivamente realizada

        const tableExists = await queryRunner.hasTable('turmas_alunos_treinamentos_contratos');
        if (tableExists) {
            // Alterar data_ass_aluno para aceitar NULL
            await queryRunner.query(`
                ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                ALTER COLUMN "data_ass_aluno" DROP NOT NULL
            `);

            // Alterar data_ass_test_um para aceitar NULL
            await queryRunner.query(`
                ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                ALTER COLUMN "data_ass_test_um" DROP NOT NULL
            `);

            // Alterar data_ass_test_dois para aceitar NULL
            await queryRunner.query(`
                ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                ALTER COLUMN "data_ass_test_dois" DROP NOT NULL
            `);

            console.log('✅ Colunas de data de assinatura agora permitem valores nulos');
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Reverter: tornar as colunas NOT NULL novamente
        const tableExists = await queryRunner.hasTable('turmas_alunos_treinamentos_contratos');
        if (tableExists) {
            // Primeiro, atualizar registros com NULL para uma data padrão
            await queryRunner.query(`
                UPDATE "turmas_alunos_treinamentos_contratos" 
                SET "data_ass_aluno" = COALESCE("data_ass_aluno", "criado_em")
                WHERE "data_ass_aluno" IS NULL
            `);

            await queryRunner.query(`
                UPDATE "turmas_alunos_treinamentos_contratos" 
                SET "data_ass_test_um" = COALESCE("data_ass_test_um", "criado_em")
                WHERE "data_ass_test_um" IS NULL
            `);

            await queryRunner.query(`
                UPDATE "turmas_alunos_treinamentos_contratos" 
                SET "data_ass_test_dois" = COALESCE("data_ass_test_dois", "criado_em")
                WHERE "data_ass_test_dois" IS NULL
            `);

            // Depois, adicionar a restrição NOT NULL de volta
            await queryRunner.query(`
                ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                ALTER COLUMN "data_ass_aluno" SET NOT NULL
            `);

            await queryRunner.query(`
                ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                ALTER COLUMN "data_ass_test_um" SET NOT NULL
            `);

            await queryRunner.query(`
                ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                ALTER COLUMN "data_ass_test_dois" SET NOT NULL
            `);
        }
    }
}
