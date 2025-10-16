import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddZapSignIntegrationFields1759775000000 implements MigrationInterface {
    name = 'AddZapSignIntegrationFields1759775000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        const tableExists = await queryRunner.hasTable('turmas_alunos_treinamentos_contratos');
        if (tableExists) {
            // Verificar se as colunas existem antes de adicioná-las
            const hasZapSignDocumentId = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'zapsign_document_id');
            const hasZapSignSignersData = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'zapsign_signers_data');
            const hasZapSignDocumentStatus = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'zapsign_document_status');

            // Adicionar campos para integração com ZapSign
            if (!hasZapSignDocumentId) {
                await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" ADD COLUMN "zapsign_document_id" character varying`);
                console.log('✅ Coluna zapsign_document_id adicionada');
            }

            if (!hasZapSignSignersData) {
                await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" ADD COLUMN "zapsign_signers_data" jsonb`);
                console.log('✅ Coluna zapsign_signers_data adicionada');
            }

            if (!hasZapSignDocumentStatus) {
                await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" ADD COLUMN "zapsign_document_status" jsonb`);
                console.log('✅ Coluna zapsign_document_status adicionada');
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const tableExists = await queryRunner.hasTable('turmas_alunos_treinamentos_contratos');
        if (tableExists) {
            // Verificar se as colunas existem antes de removê-las
            const hasZapSignDocumentId = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'zapsign_document_id');
            const hasZapSignSignersData = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'zapsign_signers_data');
            const hasZapSignDocumentStatus = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'zapsign_document_status');

            // Remover campos de integração com ZapSign
            if (hasZapSignDocumentStatus) {
                await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" DROP COLUMN "zapsign_document_status"`);
            }

            if (hasZapSignSignersData) {
                await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" DROP COLUMN "zapsign_signers_data"`);
            }

            if (hasZapSignDocumentId) {
                await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" DROP COLUMN "zapsign_document_id"`);
            }
        }
    }
}
