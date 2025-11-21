import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddParcialmenteAssinadoStatus1763000000000 implements MigrationInterface {
    name = 'AddParcialmenteAssinadoStatus1763000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        const tableExists = await queryRunner.hasTable('turmas_alunos_treinamentos_contratos');

        if (tableExists) {
            // Adicionar o novo valor ao enum para status_ass_aluno
            await queryRunner.query(`
                ALTER TYPE "EStatusAssinaturasContratosAluno" 
                ADD VALUE IF NOT EXISTS 'PARCIALMENTE_ASSINADO';
            `);

            // Adicionar o novo valor ao enum para status_ass_test_um
            await queryRunner.query(`
                ALTER TYPE "EStatusAssinaturasContratosTestUm" 
                ADD VALUE IF NOT EXISTS 'PARCIALMENTE_ASSINADO';
            `);

            // Adicionar o novo valor ao enum para status_ass_test_dois
            await queryRunner.query(`
                ALTER TYPE "EStatusAssinaturasContratosTestDois" 
                ADD VALUE IF NOT EXISTS 'PARCIALMENTE_ASSINADO';
            `);

            console.log('✅ Valor PARCIALMENTE_ASSINADO adicionado aos enums de status de assinatura');
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Não é possível remover valores de enum no PostgreSQL facilmente
        // Esta migration não pode ser revertida de forma segura
        console.warn('⚠️  Não é possível remover valores de enum. Migration não pode ser revertida.');
    }
}
