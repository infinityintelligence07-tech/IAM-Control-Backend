import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMentoriaDuracaoAndPeriodo1774800000000 implements MigrationInterface {
    name = 'AddMentoriaDuracaoAndPeriodo1774800000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Duração (em meses) da mentoria. NULL para treinamentos/palestras.
        await queryRunner.query(`
            ALTER TABLE "treinamentos"
            ADD COLUMN IF NOT EXISTS "duracao_meses" integer NULL
        `);

        // Período individual do mentorado dentro da turma de mentoria.
        // A duração passa a contar a partir da assinatura/finalização do contrato.
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos"
            ADD COLUMN IF NOT EXISTS "data_inicio_mentoria" date NULL
        `);
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos"
            ADD COLUMN IF NOT EXISTS "data_fim_mentoria" date NULL
        `);

        // Padroniza os cadastros existentes das mentorias conhecidas.
        // Marca como mentoria e define a duração padrão de 12 meses (1 ano).
        await queryRunner.query(`
            UPDATE "treinamentos"
            SET "tipo_mentoria" = true,
                "duracao_meses" = 12
            WHERE lower("treinamento") LIKE '%alta frequ%ncia%'
               OR (lower("treinamento") LIKE '%prosper%' AND lower("treinamento") LIKE '%prop%sito%')
               OR lower("treinamento") LIKE '%liberty%'
        `);

        // Liberty Begin tem duração específica de 6 meses.
        await queryRunner.query(`
            UPDATE "treinamentos"
            SET "tipo_mentoria" = true,
                "duracao_meses" = 6
            WHERE lower("treinamento") LIKE '%liberty begin%'
        `);

        // Garante que qualquer treinamento já marcado como mentoria sem duração
        // definida receba o padrão de 12 meses.
        await queryRunner.query(`
            UPDATE "treinamentos"
            SET "duracao_meses" = 12
            WHERE "tipo_mentoria" = true
              AND "duracao_meses" IS NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos"
            DROP COLUMN IF EXISTS "data_fim_mentoria"
        `);
        await queryRunner.query(`
            ALTER TABLE "turmas_alunos_treinamentos"
            DROP COLUMN IF EXISTS "data_inicio_mentoria"
        `);
        await queryRunner.query(`
            ALTER TABLE "treinamentos"
            DROP COLUMN IF EXISTS "duracao_meses"
        `);
    }
}
