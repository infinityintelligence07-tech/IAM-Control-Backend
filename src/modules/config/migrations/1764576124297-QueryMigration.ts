import { MigrationInterface, QueryRunner } from "typeorm";

export class QueryMigration1764576124297 implements MigrationInterface {
    name = 'QueryMigration1764576124297'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."ETiposProdutos" AS ENUM('LIVRO', 'MATERIAL_ESCRITORIO', 'OUTRO', 'VESTUARIO')`);
        await queryRunner.query(`CREATE TABLE "produtos" ("criado_em" TIMESTAMP NOT NULL DEFAULT now(), "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(), "deletado_em" TIMESTAMP, "criado_por" integer, "atualizado_por" integer, "id" SERIAL NOT NULL, "produto" character varying NOT NULL, "tipo_produto" "public"."ETiposProdutos" NOT NULL DEFAULT 'OUTRO', "preco" double precision NOT NULL, CONSTRAINT "pk_produtos" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."EFormasPagamento" AS ENUM('BOLETO', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'PIX')`);
        await queryRunner.query(`CREATE TABLE "turmas_alunos_produtos" ("criado_em" TIMESTAMP NOT NULL DEFAULT now(), "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(), "deletado_em" TIMESTAMP, "criado_por" integer, "atualizado_por" integer, "id" BIGSERIAL NOT NULL, "id_turma_aluno" bigint NOT NULL, "id_produto" integer NOT NULL, "quantidade" integer NOT NULL, "preco_produto_evento" double precision NOT NULL, "subtotal" double precision NOT NULL, "forma_pgto" "public"."EFormasPagamento" NOT NULL, CONSTRAINT "pk_turmas_alunos_prd" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "treinamentos" ("criado_em" TIMESTAMP NOT NULL DEFAULT now(), "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(), "deletado_em" TIMESTAMP, "criado_por" integer, "atualizado_por" integer, "id" SERIAL NOT NULL, "treinamento" character varying NOT NULL, "sigla_treinamento" character varying, "preco_treinamento" double precision NOT NULL, "url_logo_treinamento" character varying, "tipo_treinamento" boolean NOT NULL, "tipo_palestra" boolean NOT NULL, "tipo_online" boolean NOT NULL, CONSTRAINT "pk_treinamentos" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."documentos_tipo_documento_enum" AS ENUM('CONTRATO', 'TERMO')`);
        await queryRunner.query(`CREATE TABLE "documentos" ("criado_em" TIMESTAMP NOT NULL DEFAULT now(), "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(), "deletado_em" TIMESTAMP, "criado_por" integer, "atualizado_por" integer, "id" SERIAL NOT NULL, "documento" character varying, "tipo_documento" "public"."documentos_tipo_documento_enum" NOT NULL, "campos_documento" jsonb, "clausulas" text NOT NULL, "treinamentos_relacionados" jsonb, CONSTRAINT "pk_documentos" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."EStatusAssinaturasContratosAluno" AS ENUM('ASSINADO', 'ASSINATURA_PENDENTE', 'PARCIALMENTE_ASSINADO')`);
        await queryRunner.query(`CREATE TYPE "public"."EStatusAssinaturasContratosTestUm" AS ENUM('ASSINADO', 'ASSINATURA_PENDENTE', 'PARCIALMENTE_ASSINADO')`);
        await queryRunner.query(`CREATE TYPE "public"."EStatusAssinaturasContratosTestDois" AS ENUM('ASSINADO', 'ASSINATURA_PENDENTE', 'PARCIALMENTE_ASSINADO')`);
        await queryRunner.query(`CREATE TABLE "turmas_alunos_treinamentos_contratos" ("criado_em" TIMESTAMP NOT NULL DEFAULT now(), "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(), "deletado_em" TIMESTAMP, "criado_por" integer, "atualizado_por" integer, "id" BIGSERIAL NOT NULL, "id_turma_aluno_treinamento" bigint NOT NULL, "id_documento" integer NOT NULL, "status_ass_aluno" "public"."EStatusAssinaturasContratosAluno" NOT NULL DEFAULT 'ASSINATURA_PENDENTE', "data_ass_aluno" TIMESTAMP, "testemunha_um" integer, "status_ass_test_um" "public"."EStatusAssinaturasContratosTestUm" DEFAULT 'ASSINATURA_PENDENTE', "data_ass_test_um" TIMESTAMP, "testemunha_dois" integer, "status_ass_test_dois" "public"."EStatusAssinaturasContratosTestDois" DEFAULT 'ASSINATURA_PENDENTE', "data_ass_test_dois" TIMESTAMP, "dados_contrato" jsonb, "assinatura_aluno_base64" text, "tipo_assinatura_aluno" character varying, "foto_documento_aluno_base64" text, "assinatura_testemunha_um_base64" text, "tipo_assinatura_testemunha_um" character varying, "assinatura_testemunha_dois_base64" text, "tipo_assinatura_testemunha_dois" character varying, "assinatura_eletronica" character varying, "zapsign_document_id" character varying, "zapsign_signers_data" jsonb, "zapsign_document_status" jsonb, CONSTRAINT "pk_turmas_alunos_trn_ctt" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "turmas_alunos_treinamentos" ("criado_em" TIMESTAMP NOT NULL DEFAULT now(), "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(), "deletado_em" TIMESTAMP, "criado_por" integer, "atualizado_por" integer, "id" BIGSERIAL NOT NULL, "id_turma_aluno" bigint NOT NULL, "id_treinamento" integer NOT NULL, "preco_treinamento" double precision NOT NULL, "forma_pgto" jsonb NOT NULL, "preco_total_pago" double precision NOT NULL, CONSTRAINT "pk_turmas_alunos_trn" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."EOrigemAlunos" AS ENUM('ALUNO_BONUS', 'COMPROU_INGRESSO')`);
        await queryRunner.query(`CREATE TYPE "public"."EStatusAlunosTurmas" AS ENUM('AGUARDANDO_CHECKIN', 'CANCELADO', 'CHECKIN_REALIZADO', 'FALTA_ENVIAR_LINK_CHECKIN')`);
        await queryRunner.query(`CREATE TYPE "public"."EPresencaTurmas" AS ENUM('NO_SHOW', 'PRESENTE')`);
        await queryRunner.query(`CREATE TABLE "turmas_alunos" ("criado_em" TIMESTAMP NOT NULL DEFAULT now(), "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(), "deletado_em" TIMESTAMP, "criado_por" integer, "atualizado_por" integer, "id" BIGSERIAL NOT NULL, "id_turma" integer NOT NULL, "id_aluno" integer, "id_aluno_bonus" bigint, "url_comprovante_pgto" character varying, "origem_aluno" "public"."EOrigemAlunos", "status_aluno_turma" "public"."EStatusAlunosTurmas", "nome_cracha" character varying NOT NULL, "numero_cracha" character varying NOT NULL, "presenca_turma" "public"."EPresencaTurmas", "vaga_bonus" boolean NOT NULL DEFAULT false, "adquiriu_livros" boolean NOT NULL DEFAULT false, "adquiriu_outros_itens" boolean NOT NULL DEFAULT false, CONSTRAINT "pk_turmas_alunos" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "masterclass_pre_cadastros" ("criado_em" TIMESTAMP NOT NULL DEFAULT now(), "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(), "deletado_em" TIMESTAMP, "criado_por" integer, "atualizado_por" integer, "id" BIGSERIAL NOT NULL, "nome_aluno" character varying NOT NULL, "email" character varying NOT NULL, "telefone" character varying NOT NULL, "evento_nome" character varying NOT NULL, "data_evento" date NOT NULL, "id_turma" integer NOT NULL, "presente" boolean NOT NULL DEFAULT false, "teve_interesse" boolean NOT NULL DEFAULT false, "id_aluno_vinculado" integer, "data_vinculacao_aluno" TIMESTAMP, "observacoes" character varying, CONSTRAINT "pk_masterclass_pre_cadastros" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."EProfissao" AS ENUM('CLT', 'DESEMPREGADO', 'EMPRESARIO', 'FUNCIONARIO_PUBLICO', 'LIDER', 'PROFISSIONAL_LIBERAL')`);
        await queryRunner.query(`CREATE TYPE "public"."EStatusAlunosGeral" AS ENUM('ATIVO', 'INADIMPLENTE', 'INATIVO', 'PENDENTE', 'SUSPENSO', 'CANCELADO')`);
        await queryRunner.query(`CREATE TYPE "public"."ETipoVinculoAluno" AS ENUM('BONUS', 'CONVIDADO')`);
        await queryRunner.query(`CREATE TABLE "alunos" ("criado_em" TIMESTAMP NOT NULL DEFAULT now(), "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(), "deletado_em" TIMESTAMP, "criado_por" integer, "atualizado_por" integer, "id" SERIAL NOT NULL, "id_polo" integer NOT NULL, "nome" character varying NOT NULL, "nome_cracha" character varying NOT NULL, "email" character varying NOT NULL, "senha" character varying, "genero" character varying, "cpf" character varying, "data_nascimento" character varying, "telefone_um" character varying NOT NULL, "telefone_dois" character varying, "cep" character varying, "logradouro" character varying, "complemento" character varying, "numero" character varying, "bairro" character varying, "cidade" character varying, "estado" character varying, "profissao" "public"."EProfissao" DEFAULT 'CLT', "status_aluno_geral" "public"."EStatusAlunosGeral" DEFAULT 'PENDENTE', "possui_deficiencia" boolean NOT NULL, "desc_deficiencia" character varying, "url_foto_aluno" character varying, "id_aluno_vinculado" integer, "tipo_vinculo" "public"."ETipoVinculoAluno", "id_treinamento_bonus" integer, CONSTRAINT "UQ_1f9a8f3f4e5a314a2d7f828a605" UNIQUE ("email"), CONSTRAINT "pk_alunos" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "polos" ("criado_em" TIMESTAMP NOT NULL DEFAULT now(), "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(), "deletado_em" TIMESTAMP, "criado_por" integer, "atualizado_por" integer, "id" SERIAL NOT NULL, "sigla_polo" character varying NOT NULL, "polo" character varying NOT NULL, "cidade" character varying NOT NULL, "estado" character varying NOT NULL, CONSTRAINT "pk_polos" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "endereco_eventos" ("criado_em" TIMESTAMP NOT NULL DEFAULT now(), "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(), "deletado_em" TIMESTAMP, "criado_por" integer, "atualizado_por" integer, "id" SERIAL NOT NULL, "id_polo" integer NOT NULL, "local_evento" character varying, "logradouro" character varying, "numero" character varying, "bairro" character varying, "cidade" character varying, "estado" character varying, "cep" character varying, CONSTRAINT "pk_endereco_eventos" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."EStatusTurmas" AS ENUM('ENCERRADA', 'INSCRICOES_ABERTAS', 'INSCRICOES_PAUSADAS')`);
        await queryRunner.query(`CREATE TABLE "turmas" ("criado_em" TIMESTAMP NOT NULL DEFAULT now(), "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(), "deletado_em" TIMESTAMP, "criado_por" integer, "atualizado_por" integer, "id" SERIAL NOT NULL, "id_polo" integer NOT NULL, "id_treinamento" integer NOT NULL, "lider_evento" integer NOT NULL, "edicao_turma" character varying, "cep" character varying NOT NULL, "logradouro" character varying NOT NULL, "complemento" character varying, "numero" character varying NOT NULL, "bairro" character varying NOT NULL, "cidade" character varying, "estado" character varying, "id_endereco_evento" integer, "status_turma" "public"."EStatusTurmas" NOT NULL DEFAULT 'INSCRICOES_ABERTAS', "autorizar_bonus" boolean NOT NULL DEFAULT false, "id_turma_bonus" integer, "capacidade_turma" integer NOT NULL, "meta" integer, "data_inicio" date NOT NULL, "data_final" date NOT NULL, "turma_aberta" boolean NOT NULL DEFAULT false, "detalhamento_bonus" jsonb, CONSTRAINT "pk_turmas" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "password_recovery_tokens" ("id" SERIAL NOT NULL, "id_usuario" integer NOT NULL, "token" uuid NOT NULL, "criado_em" TIMESTAMP NOT NULL DEFAULT now(), "expira_em" TIMESTAMP NOT NULL, CONSTRAINT "UQ_348e18409077c1d7375df2bdd48" UNIQUE ("token"), CONSTRAINT "PK_b2f6517d7ff21fc7de98f66cbb0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."ESetores" AS ENUM('ADMINISTRADOR', 'CD', 'COMERCIAL', 'CUIDADO_DE_ALUNOS', 'EVENTOS', 'EXPANSAO', 'EXPANSAO_NEGOCIOS', 'FINANCEIRO', 'GH', 'IAM_STORE', 'JURIDICO', 'MANUTENCAO', 'MARKETING', 'P7', 'TECNOLOGIA')`);
        await queryRunner.query(`CREATE TYPE "public"."EFuncoes" AS ENUM('ADMINISTRADOR', 'ADVOGADO', 'CLIPADOR', 'COLABORADOR', 'COPYWRITER', 'DESENVOLVEDOR', 'DESIGNER_GRAFICO', 'DJ', 'EDICAO_DE_VIDEO', 'ESTAGIARIO', 'FOTOGRAFO', 'INSIDE_SALES', 'LIDER', 'LIDER_DE_CONFRONTO', 'LIDER_DE_MASTERCLASS', 'LIDER_DE_EVENTOS', 'LOGISTICA', 'PALESTRANTE', 'RELACIONAMENTO_COM_CLIENTES', 'SOCIAL_MEDIA', 'SOCIAL_SELLING', 'STAFF', 'TRAFEGO_DIGITAL', 'TUTOR_MISSAO', 'VENDEDOR', 'WEB_DESIGNER')`);
        await queryRunner.query(`CREATE TABLE "usuarios" ("criado_em" TIMESTAMP NOT NULL DEFAULT now(), "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(), "deletado_em" TIMESTAMP, "criado_por" integer, "atualizado_por" integer, "id" SERIAL NOT NULL, "nome" character varying NOT NULL, "primeiro_nome" character varying NOT NULL, "sobrenome" character varying NOT NULL, "cpf" character varying, "email" character varying NOT NULL, "senha" character varying NOT NULL, "setor" "public"."ESetores" NOT NULL DEFAULT 'CUIDADO_DE_ALUNOS', "funcao" "public"."EFuncoes" array NOT NULL DEFAULT '{COLABORADOR}', "telefone" character varying NOT NULL, "url_foto" character varying, CONSTRAINT "UQ_446adfc18b35418aac32ae0b7b5" UNIQUE ("email"), CONSTRAINT "pk_usuarios" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "turmas_alunos_treinamentos_bonus" ("criado_em" TIMESTAMP NOT NULL DEFAULT now(), "atualizado_em" TIMESTAMP NOT NULL DEFAULT now(), "deletado_em" TIMESTAMP, "criado_por" integer, "atualizado_por" integer, "id" BIGSERIAL NOT NULL, "id_turma_aluno" bigint NOT NULL, "ganhadores_bonus" jsonb array NOT NULL, CONSTRAINT "pk_turmas_alunos_trn_brn" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_produtos" ADD CONSTRAINT "FK_90345cf6a43b9eb771a5b0c7aed" FOREIGN KEY ("id_turma_aluno") REFERENCES "turmas_alunos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_produtos" ADD CONSTRAINT "FK_24fc81c323f759df92562cce38f" FOREIGN KEY ("id_produto") REFERENCES "produtos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" ADD CONSTRAINT "FK_041c6f850454c7cbfdb9afd0785" FOREIGN KEY ("id_turma_aluno_treinamento") REFERENCES "turmas_alunos_treinamentos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" ADD CONSTRAINT "FK_363b06da3d2e7b6143f904605b5" FOREIGN KEY ("id_documento") REFERENCES "documentos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" ADD CONSTRAINT "FK_f270e820f6208fc77e001fca987" FOREIGN KEY ("testemunha_um") REFERENCES "usuarios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" ADD CONSTRAINT "FK_df26401b2682b9431da200ebc05" FOREIGN KEY ("testemunha_dois") REFERENCES "usuarios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos" ADD CONSTRAINT "FK_9654eb9b319165ec87dee9d91f5" FOREIGN KEY ("id_turma_aluno") REFERENCES "turmas_alunos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos" ADD CONSTRAINT "FK_f7cb9168f00cfa90fa808c277e1" FOREIGN KEY ("id_treinamento") REFERENCES "treinamentos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" ADD CONSTRAINT "FK_cf9504cc93ace684979a70b4178" FOREIGN KEY ("id_aluno") REFERENCES "alunos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" ADD CONSTRAINT "FK_e66c888b3afc3881dcf9d4c17a4" FOREIGN KEY ("id_turma") REFERENCES "turmas"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "masterclass_pre_cadastros" ADD CONSTRAINT "FK_2b53401465f54dfcf5c468952b1" FOREIGN KEY ("id_turma") REFERENCES "turmas"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "masterclass_pre_cadastros" ADD CONSTRAINT "FK_1280c15003c95878b8479d9f288" FOREIGN KEY ("id_aluno_vinculado") REFERENCES "alunos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "alunos" ADD CONSTRAINT "FK_25683226dcf8656489ad2a322a8" FOREIGN KEY ("id_polo") REFERENCES "polos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "alunos" ADD CONSTRAINT "FK_2f04d4ddb0a4d639b2f22597f24" FOREIGN KEY ("id_aluno_vinculado") REFERENCES "alunos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "endereco_eventos" ADD CONSTRAINT "FK_62dcc74ace6ea48c387fabb0388" FOREIGN KEY ("id_polo") REFERENCES "polos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "turmas" ADD CONSTRAINT "FK_2c68e7bcc1349b310e5a6bbf0f8" FOREIGN KEY ("id_polo") REFERENCES "polos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "turmas" ADD CONSTRAINT "FK_2e143f05f1f6ecbaab4a472227b" FOREIGN KEY ("id_treinamento") REFERENCES "treinamentos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "turmas" ADD CONSTRAINT "FK_0f13445944f452b18d0c712b238" FOREIGN KEY ("lider_evento") REFERENCES "usuarios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "turmas" ADD CONSTRAINT "FK_10af650d5a41dca39c724f65830" FOREIGN KEY ("id_endereco_evento") REFERENCES "endereco_eventos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "password_recovery_tokens" ADD CONSTRAINT "FK_cef7352c328ee714ba0768e7cb0" FOREIGN KEY ("id_usuario") REFERENCES "usuarios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_bonus" ADD CONSTRAINT "FK_736650b41f97f97f01ca66acad3" FOREIGN KEY ("id_turma_aluno") REFERENCES "turmas_alunos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_bonus" DROP CONSTRAINT "FK_736650b41f97f97f01ca66acad3"`);
        await queryRunner.query(`ALTER TABLE "password_recovery_tokens" DROP CONSTRAINT "FK_cef7352c328ee714ba0768e7cb0"`);
        await queryRunner.query(`ALTER TABLE "turmas" DROP CONSTRAINT "FK_10af650d5a41dca39c724f65830"`);
        await queryRunner.query(`ALTER TABLE "turmas" DROP CONSTRAINT "FK_0f13445944f452b18d0c712b238"`);
        await queryRunner.query(`ALTER TABLE "turmas" DROP CONSTRAINT "FK_2e143f05f1f6ecbaab4a472227b"`);
        await queryRunner.query(`ALTER TABLE "turmas" DROP CONSTRAINT "FK_2c68e7bcc1349b310e5a6bbf0f8"`);
        await queryRunner.query(`ALTER TABLE "endereco_eventos" DROP CONSTRAINT "FK_62dcc74ace6ea48c387fabb0388"`);
        await queryRunner.query(`ALTER TABLE "alunos" DROP CONSTRAINT "FK_2f04d4ddb0a4d639b2f22597f24"`);
        await queryRunner.query(`ALTER TABLE "alunos" DROP CONSTRAINT "FK_25683226dcf8656489ad2a322a8"`);
        await queryRunner.query(`ALTER TABLE "masterclass_pre_cadastros" DROP CONSTRAINT "FK_1280c15003c95878b8479d9f288"`);
        await queryRunner.query(`ALTER TABLE "masterclass_pre_cadastros" DROP CONSTRAINT "FK_2b53401465f54dfcf5c468952b1"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" DROP CONSTRAINT "FK_e66c888b3afc3881dcf9d4c17a4"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos" DROP CONSTRAINT "FK_cf9504cc93ace684979a70b4178"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos" DROP CONSTRAINT "FK_f7cb9168f00cfa90fa808c277e1"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos" DROP CONSTRAINT "FK_9654eb9b319165ec87dee9d91f5"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" DROP CONSTRAINT "FK_df26401b2682b9431da200ebc05"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" DROP CONSTRAINT "FK_f270e820f6208fc77e001fca987"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" DROP CONSTRAINT "FK_363b06da3d2e7b6143f904605b5"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_treinamentos_contratos" DROP CONSTRAINT "FK_041c6f850454c7cbfdb9afd0785"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_produtos" DROP CONSTRAINT "FK_24fc81c323f759df92562cce38f"`);
        await queryRunner.query(`ALTER TABLE "turmas_alunos_produtos" DROP CONSTRAINT "FK_90345cf6a43b9eb771a5b0c7aed"`);
        await queryRunner.query(`DROP TABLE "turmas_alunos_treinamentos_bonus"`);
        await queryRunner.query(`DROP TABLE "usuarios"`);
        await queryRunner.query(`DROP TYPE "public"."EFuncoes"`);
        await queryRunner.query(`DROP TYPE "public"."ESetores"`);
        await queryRunner.query(`DROP TABLE "password_recovery_tokens"`);
        await queryRunner.query(`DROP TABLE "turmas"`);
        await queryRunner.query(`DROP TYPE "public"."EStatusTurmas"`);
        await queryRunner.query(`DROP TABLE "endereco_eventos"`);
        await queryRunner.query(`DROP TABLE "polos"`);
        await queryRunner.query(`DROP TABLE "alunos"`);
        await queryRunner.query(`DROP TYPE "public"."ETipoVinculoAluno"`);
        await queryRunner.query(`DROP TYPE "public"."EStatusAlunosGeral"`);
        await queryRunner.query(`DROP TYPE "public"."EProfissao"`);
        await queryRunner.query(`DROP TABLE "masterclass_pre_cadastros"`);
        await queryRunner.query(`DROP TABLE "turmas_alunos"`);
        await queryRunner.query(`DROP TYPE "public"."EPresencaTurmas"`);
        await queryRunner.query(`DROP TYPE "public"."EStatusAlunosTurmas"`);
        await queryRunner.query(`DROP TYPE "public"."EOrigemAlunos"`);
        await queryRunner.query(`DROP TABLE "turmas_alunos_treinamentos"`);
        await queryRunner.query(`DROP TABLE "turmas_alunos_treinamentos_contratos"`);
        await queryRunner.query(`DROP TYPE "public"."EStatusAssinaturasContratosTestDois"`);
        await queryRunner.query(`DROP TYPE "public"."EStatusAssinaturasContratosTestUm"`);
        await queryRunner.query(`DROP TYPE "public"."EStatusAssinaturasContratosAluno"`);
        await queryRunner.query(`DROP TABLE "documentos"`);
        await queryRunner.query(`DROP TYPE "public"."documentos_tipo_documento_enum"`);
        await queryRunner.query(`DROP TABLE "treinamentos"`);
        await queryRunner.query(`DROP TABLE "turmas_alunos_produtos"`);
        await queryRunner.query(`DROP TYPE "public"."EFormasPagamento"`);
        await queryRunner.query(`DROP TABLE "produtos"`);
        await queryRunner.query(`DROP TYPE "public"."ETiposProdutos"`);
    }

}
