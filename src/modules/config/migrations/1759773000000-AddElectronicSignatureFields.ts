import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddElectronicSignatureFields1759773000000 implements MigrationInterface {
    name = 'AddElectronicSignatureFields1759773000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        const tableExists = await queryRunner.hasTable('turmas_alunos_treinamentos_contratos');
        if (tableExists) {
            // Verificar se a coluna assinatura_eletronica já existe
            const hasAssinaturaEletronica = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'assinatura_eletronica');
            if (!hasAssinaturaEletronica) {
                await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" ADD COLUMN "assinatura_eletronica" varchar`);
            }

            // Verificar se a coluna data_assinatura_eletronica já existe
            const hasDataAssinaturaEletronica = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'data_assinatura_eletronica');
            if (!hasDataAssinaturaEletronica) {
                await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" ADD COLUMN "data_assinatura_eletronica" timestamp`);
            }

            // Verificar se a coluna status_assinatura_eletronica já existe
            const hasStatusAssinaturaEletronica = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'status_assinatura_eletronica');
            if (!hasStatusAssinaturaEletronica) {
                await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" ADD COLUMN "status_assinatura_eletronica" varchar`);
            }

            console.log('✅ Campos de assinatura eletrônica adicionados com sucesso');
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const tableExists = await queryRunner.hasTable('turmas_alunos_treinamentos_contratos');
        if (tableExists) {
            // Verificar se a coluna assinatura_eletronica existe antes de remover
            const hasAssinaturaEletronica = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'assinatura_eletronica');
            if (hasAssinaturaEletronica) {
                await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" DROP COLUMN "assinatura_eletronica"`);
            }

            // Verificar se a coluna data_assinatura_eletronica existe antes de remover
            const hasDataAssinaturaEletronica = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'data_assinatura_eletronica');
            if (hasDataAssinaturaEletronica) {
                await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" DROP COLUMN "data_assinatura_eletronica"`);
            }

            // Verificar se a coluna status_assinatura_eletronica existe antes de remover
            const hasStatusAssinaturaEletronica = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'status_assinatura_eletronica');
            if (hasStatusAssinaturaEletronica) {
                await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" DROP COLUMN "status_assinatura_eletronica"`);
            }

            console.log('✅ Campos de assinatura eletrônica removidos com sucesso');
        }
    }
}
