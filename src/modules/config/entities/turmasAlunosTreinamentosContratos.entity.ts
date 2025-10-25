import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { EStatusAssinaturasContratos } from './enum';
import { TurmasAlunosTreinamentos } from './turmasAlunosTreinamentos.entity';
import { Usuarios } from './usuarios.entity';
import { Documentos } from './documentos.entity';

@Entity('turmas_alunos_treinamentos_contratos', { schema: type_schema })
export class TurmasAlunosTreinamentosContratos extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'id', primaryKeyConstraintName: 'pk_turmas_alunos_trn_ctt' })
    id: string;

    @Column({ type: 'bigint', name: 'id_turma_aluno_treinamento', nullable: false })
    id_turma_aluno_treinamento: string;

    @Column({ type: 'int', name: 'id_documento', nullable: false })
    id_documento: number;

    @Column({
        type: 'enum',
        enum: EStatusAssinaturasContratos,
        enumName: 'EStatusAssinaturasContratosAluno',
        name: 'status_ass_aluno',
        default: EStatusAssinaturasContratos.ASSINATURA_PENDENTE,
        nullable: false,
    })
    status_ass_aluno: EStatusAssinaturasContratos;

    @Column({ type: 'timestamp', name: 'data_ass_aluno', nullable: true })
    data_ass_aluno: Date;

    @Column({ type: 'int', name: 'testemunha_um', nullable: true })
    testemunha_um: number;

    @Column({
        type: 'enum',
        enum: EStatusAssinaturasContratos,
        enumName: 'EStatusAssinaturasContratosTestUm',
        name: 'status_ass_test_um',
        default: EStatusAssinaturasContratos.ASSINATURA_PENDENTE,
        nullable: true,
    })
    status_ass_test_um: EStatusAssinaturasContratos;

    @Column({ type: 'timestamp', name: 'data_ass_test_um', nullable: true })
    data_ass_test_um: Date;

    @Column({ type: 'int', name: 'testemunha_dois', nullable: true })
    testemunha_dois: number;

    @Column({
        type: 'enum',
        enum: EStatusAssinaturasContratos,
        enumName: 'EStatusAssinaturasContratosTestDois',
        name: 'status_ass_test_dois',
        default: EStatusAssinaturasContratos.ASSINATURA_PENDENTE,
        nullable: true,
    })
    status_ass_test_dois: EStatusAssinaturasContratos;

    @Column({ type: 'timestamp', name: 'data_ass_test_dois', nullable: true })
    data_ass_test_dois: Date;

    @Column({ type: 'jsonb', name: 'dados_contrato', nullable: true })
    dados_contrato: any;

    // Campos para assinatura do aluno
    @Column({ type: 'text', name: 'assinatura_aluno_base64', nullable: true })
    assinatura_aluno_base64: string;

    @Column({ type: 'varchar', name: 'tipo_assinatura_aluno', nullable: true })
    tipo_assinatura_aluno: string; // 'escrita' ou 'nome'

    @Column({ type: 'text', name: 'foto_documento_aluno_base64', nullable: true })
    foto_documento_aluno_base64: string;

    // Campos para assinatura da testemunha 1
    @Column({ type: 'text', name: 'assinatura_testemunha_um_base64', nullable: true })
    assinatura_testemunha_um_base64: string;

    @Column({ type: 'varchar', name: 'tipo_assinatura_testemunha_um', nullable: true })
    tipo_assinatura_testemunha_um: string;

    // Campos para assinatura da testemunha 2
    @Column({ type: 'text', name: 'assinatura_testemunha_dois_base64', nullable: true })
    assinatura_testemunha_dois_base64: string;

    @Column({ type: 'varchar', name: 'tipo_assinatura_testemunha_dois', nullable: true })
    tipo_assinatura_testemunha_dois: string;

    // Campo para assinatura eletrônica (usa data_ass_aluno e status_ass_aluno existentes)
    @Column({ type: 'varchar', name: 'assinatura_eletronica', nullable: true })
    assinatura_eletronica: string;

    // Campos para integração com ZapSign
    @Column({ type: 'varchar', name: 'zapsign_document_id', nullable: true })
    zapsign_document_id: string; // ID com hash do código do documento da URL + ID numérico

    @Column({ type: 'jsonb', name: 'zapsign_signers_data', nullable: true })
    zapsign_signers_data: Array<{
        name: string; // nome do assinante
        email?: string; // email do assinante (opcional)
        telefone?: string; // telefone do assinante (opcional)
        cpf: string; // cpf do assinante
        status: string; // status da assinatura
        signing_url: string; // url para assinatura do usuário
    }>; // Array de objetos com dados de todos os assinantes (aluno e testemunhas)

    @Column({ type: 'jsonb', name: 'zapsign_document_status', nullable: true })
    zapsign_document_status: {
        status: string; // status do documento
        created_at: string; // data de criação do documento
        document_id: string; // id e token do documento
        signing_url: string; // url de assinatura do documento
    }; // Objeto com status completo do documento

    @ManyToOne(() => TurmasAlunosTreinamentos, (turmasAlunosTreinamentos) => turmasAlunosTreinamentos.turmasAlunosTreinamentosContratos)
    @JoinColumn([{ name: 'id_turma_aluno_treinamento', referencedColumnName: 'id' }])
    id_turma_aluno_treinamento_fk: TurmasAlunosTreinamentos;

    @ManyToOne(() => Documentos, (documentos) => documentos.turmasAlunosTreinamentosContratos)
    @JoinColumn([{ name: 'id_documento', referencedColumnName: 'id' }])
    id_documento_fk: Documentos;

    @ManyToOne(() => Usuarios, (usuarios) => usuarios.turmasAlunosTreinamentosContratos_t_um)
    @JoinColumn([{ name: 'testemunha_um', referencedColumnName: 'id' }])
    testemunha_um_fk: Usuarios;

    @ManyToOne(() => Usuarios, (usuarios) => usuarios.turmasAlunosTreinamentosContratos_t_dois)
    @JoinColumn([{ name: 'testemunha_dois', referencedColumnName: 'id' }])
    testemunha_dois_fk: Usuarios;
}
