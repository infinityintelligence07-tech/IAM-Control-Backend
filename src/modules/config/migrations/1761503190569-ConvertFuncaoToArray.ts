import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertFuncaoToArray1761503190569 implements MigrationInterface {
    name = 'ConvertFuncaoToArray1761503190569';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Step 1: Add a temporary column with array type
        await queryRunner.query(`ALTER TABLE "usuarios" ADD "funcao_array" "public"."EFuncoes"[]`);

        // Step 2: Copy data from old column to new array column (wrap existing value in array)
        await queryRunner.query(`UPDATE "usuarios" SET "funcao_array" = ARRAY["funcao"] WHERE "funcao" IS NOT NULL`);
        await queryRunner.query(`UPDATE "usuarios" SET "funcao_array" = ARRAY['COLABORADOR']::"public"."EFuncoes"[] WHERE "funcao" IS NULL`);

        // Step 3: Drop the old column
        await queryRunner.query(`ALTER TABLE "usuarios" DROP COLUMN "funcao"`);

        // Step 4: Rename the new column
        await queryRunner.query(`ALTER TABLE "usuarios" RENAME COLUMN "funcao_array" TO "funcao"`);

        // Step 5: Add NOT NULL constraint and default value
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "funcao" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "funcao" SET DEFAULT ARRAY['COLABORADOR']::"public"."EFuncoes"[]`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Step 1: Add a temporary single value column
        await queryRunner.query(`ALTER TABLE "usuarios" ADD "funcao_single" "public"."EFuncoes"`);

        // Step 2: Copy data from array to single value (take first element)
        await queryRunner.query(`UPDATE "usuarios" SET "funcao_single" = "funcao"[1] WHERE array_length("funcao", 1) > 0`);
        await queryRunner.query(`UPDATE "usuarios" SET "funcao_single" = 'COLABORADOR' WHERE "funcao_single" IS NULL`);

        // Step 3: Drop the array column
        await queryRunner.query(`ALTER TABLE "usuarios" DROP COLUMN "funcao"`);

        // Step 4: Rename the single value column
        await queryRunner.query(`ALTER TABLE "usuarios" RENAME COLUMN "funcao_single" TO "funcao"`);

        // Step 5: Add NOT NULL constraint and default value
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "funcao" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "usuarios" ALTER COLUMN "funcao" SET DEFAULT 'COLABORADOR'`);
    }
}
