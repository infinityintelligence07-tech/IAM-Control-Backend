import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSignatureFields1759772000000 implements MigrationInterface {
    name = 'AddSignatureFields1759772000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Verificar se as colunas já existem antes de adicionar
        const tableExists = await queryRunner.hasTable('turmas_alunos_treinamentos_contratos');

        if (tableExists) {
            // Verificar se as colunas já existem
            const hasAssinaturaAluno = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'assinatura_aluno_base64');
            const hasTipoAssinaturaAluno = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'tipo_assinatura_aluno');
            const hasFotoDocumentoAluno = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'foto_documento_aluno_base64');
            const hasAssinaturaTestUm = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'assinatura_testemunha_um_base64');
            const hasTipoAssinaturaTestUm = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'tipo_assinatura_testemunha_um');
            const hasAssinaturaTestDois = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'assinatura_testemunha_dois_base64');
            const hasTipoAssinaturaTestDois = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'tipo_assinatura_testemunha_dois');

            // Adicionar campos para assinatura do aluno apenas se não existirem
            if (!hasAssinaturaAluno) {
                await queryRunner.query(`
                    ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                    ADD COLUMN "assinatura_aluno_base64" text
                `);
            }

            if (!hasTipoAssinaturaAluno) {
                await queryRunner.query(`
                    ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                    ADD COLUMN "tipo_assinatura_aluno" varchar
                `);
            }

            if (!hasFotoDocumentoAluno) {
                await queryRunner.query(`
                    ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                    ADD COLUMN "foto_documento_aluno_base64" text
                `);
            }

            // Adicionar campos para assinatura da testemunha 1 apenas se não existirem
            if (!hasAssinaturaTestUm) {
                await queryRunner.query(`
                    ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                    ADD COLUMN "assinatura_testemunha_um_base64" text
                `);
            }

            if (!hasTipoAssinaturaTestUm) {
                await queryRunner.query(`
                    ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                    ADD COLUMN "tipo_assinatura_testemunha_um" varchar
                `);
            }

            // Adicionar campos para assinatura da testemunha 2 apenas se não existirem
            if (!hasAssinaturaTestDois) {
                await queryRunner.query(`
                    ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                    ADD COLUMN "assinatura_testemunha_dois_base64" text
                `);
            }

            if (!hasTipoAssinaturaTestDois) {
                await queryRunner.query(`
                    ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                    ADD COLUMN "tipo_assinatura_testemunha_dois" varchar
                `);
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const tableExists = await queryRunner.hasTable('turmas_alunos_treinamentos_contratos');

        if (tableExists) {
            // Verificar se as colunas existem antes de tentar removê-las
            const hasAssinaturaAluno = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'assinatura_aluno_base64');
            const hasTipoAssinaturaAluno = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'tipo_assinatura_aluno');
            const hasFotoDocumentoAluno = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'foto_documento_aluno_base64');
            const hasAssinaturaTestUm = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'assinatura_testemunha_um_base64');
            const hasTipoAssinaturaTestUm = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'tipo_assinatura_testemunha_um');
            const hasAssinaturaTestDois = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'assinatura_testemunha_dois_base64');
            const hasTipoAssinaturaTestDois = await queryRunner.hasColumn('turmas_alunos_treinamentos_contratos', 'tipo_assinatura_testemunha_dois');

            // Remover campos para assinatura da testemunha 2 apenas se existirem
            if (hasTipoAssinaturaTestDois) {
                await queryRunner.query(`
                    ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                    DROP COLUMN "tipo_assinatura_testemunha_dois"
                `);
            }

            if (hasAssinaturaTestDois) {
                await queryRunner.query(`
                    ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                    DROP COLUMN "assinatura_testemunha_dois_base64"
                `);
            }

            // Remover campos para assinatura da testemunha 1 apenas se existirem
            if (hasTipoAssinaturaTestUm) {
                await queryRunner.query(`
                    ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                    DROP COLUMN "tipo_assinatura_testemunha_um"
                `);
            }

            if (hasAssinaturaTestUm) {
                await queryRunner.query(`
                    ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                    DROP COLUMN "assinatura_testemunha_um_base64"
                `);
            }

            // Remover campos para assinatura do aluno apenas se existirem
            if (hasFotoDocumentoAluno) {
                await queryRunner.query(`
                    ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                    DROP COLUMN "foto_documento_aluno_base64"
                `);
            }

            if (hasTipoAssinaturaAluno) {
                await queryRunner.query(`
                    ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                    DROP COLUMN "tipo_assinatura_aluno"
                `);
            }

            if (hasAssinaturaAluno) {
                await queryRunner.query(`
                    ALTER TABLE "turmas_alunos_treinamentos_contratos" 
                    DROP COLUMN "assinatura_aluno_base64"
                `);
            }
        }
    }
}
