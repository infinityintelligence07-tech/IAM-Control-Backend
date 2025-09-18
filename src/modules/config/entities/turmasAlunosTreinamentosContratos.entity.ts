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

    @Column({ type: 'timestamp', name: 'data_ass_aluno', nullable: false })
    data_ass_aluno: Date;

    @Column({ type: 'int', name: 'testemunha_um', nullable: false })
    testemunha_um: number;

    @Column({
        type: 'enum',
        enum: EStatusAssinaturasContratos,
        enumName: 'EStatusAssinaturasContratosTestUm',
        name: 'status_ass_test_um',
        default: EStatusAssinaturasContratos.ASSINATURA_PENDENTE,
        nullable: false,
    })
    status_ass_test_um: EStatusAssinaturasContratos;

    @Column({ type: 'timestamp', name: 'data_ass_test_um', nullable: false })
    data_ass_test_um: Date;

    @Column({ type: 'int', name: 'testemunha_dois', nullable: false })
    testemunha_dois: number;

    @Column({
        type: 'enum',
        enum: EStatusAssinaturasContratos,
        enumName: 'EStatusAssinaturasContratosTestDois',
        name: 'status_ass_test_dois',
        default: EStatusAssinaturasContratos.ASSINATURA_PENDENTE,
        nullable: false,
    })
    status_ass_test_dois: EStatusAssinaturasContratos;

    @Column({ type: 'timestamp', name: 'data_ass_test_dois', nullable: false })
    data_ass_test_dois: Date;

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
