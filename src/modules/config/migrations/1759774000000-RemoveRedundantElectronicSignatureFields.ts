import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveRedundantElectronicSignatureFields1759774000000 implements MigrationInterface {
    name = 'RemoveRedundantElectronicSignatureFields1759774000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        const tableExists = await queryRunner.hasTable('turmas_alunos_treinamentos_contratos');
        if (tableExists) {
            // Verificar se as colunas existem antes de removê-las
            const hasDataAssinaturaEletronica = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'data_assinatura_eletronica');
            const hasStatusAssinaturaEletronica = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'status_assinatura_eletronica');

            // Remover colunas redundantes (usamos data_ass_aluno e status_ass_aluno existentes)
            if (hasDataAssinaturaEletronica) {
                await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" DROP COLUMN "data_assinatura_eletronica"`);
                console.log('✅ Coluna data_assinatura_eletronica removida');
            }

            if (hasStatusAssinaturaEletronica) {
                await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" DROP COLUMN "status_assinatura_eletronica"`);
                console.log('✅ Coluna status_assinatura_eletronica removida');
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const tableExists = await queryRunner.hasTable('turmas_alunos_treinamentos_contratos');
        if (tableExists) {
            // Verificar se as colunas não existem antes de recriá-las
            const hasDataAssinaturaEletronica = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'data_assinatura_eletronica');
            const hasStatusAssinaturaEletronica = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'status_assinatura_eletronica');

            // Recriar colunas se necessário (rollback)
            if (!hasDataAssinaturaEletronica) {
                await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" ADD COLUMN "data_assinatura_eletronica" TIMESTAMP`);
            }

            if (!hasStatusAssinaturaEletronica) {
                await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" ADD COLUMN "status_assinatura_eletronica" character varying`);
            }
        }
    }
}
