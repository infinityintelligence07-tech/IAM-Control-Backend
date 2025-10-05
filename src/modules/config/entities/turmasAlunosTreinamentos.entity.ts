import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { TurmasAlunos } from './turmasAlunos.entity';
import { Treinamentos } from './treinamentos.entity';
import { EFormasPagamento } from './enum';
import { TurmasAlunosTreinamentosContratos } from './turmasAlunosTreinamentosContratos.entity';

@Entity('turmas_alunos_treinamentos', { schema: type_schema })
export class TurmasAlunosTreinamentos extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'id', primaryKeyConstraintName: 'pk_turmas_alunos_trn' })
    id: string;

    @Column({ type: 'bigint', name: 'id_turma_aluno', nullable: false })
    id_turma_aluno: string;

    @Column({ type: 'int', name: 'id_treinamento', nullable: false })
    id_treinamento: number;

    @Column({ type: 'float', name: 'preco_treinamento', nullable: false })
    preco_treinamento: number;

    @Column({ type: 'jsonb', name: 'forma_pgto', nullable: false })
    forma_pgto: { forma: EFormasPagamento; valor: number }[];

    @Column({ type: 'float', name: 'preco_total_pago', nullable: false })
    preco_total_pago: number;

    @ManyToOne(() => TurmasAlunos, (turmasAlunos) => turmasAlunos.turmasAlunosTreinamentos)
    @JoinColumn([{ name: 'id_turma_aluno', referencedColumnName: 'id' }])
    id_turma_aluno_fk: TurmasAlunos;

    @ManyToOne(() => Treinamentos, (treinamentos) => treinamentos.turmasAlunosTreinamentos)
    @JoinColumn([{ name: 'id_treinamento', referencedColumnName: 'id' }])
    id_treinamento_fk: Treinamentos;

    @OneToMany(() => TurmasAlunosTreinamentosContratos, (turmasAlunosTreinamentosContratos) => turmasAlunosTreinamentosContratos.id_turma_aluno_treinamento_fk)
    turmasAlunosTreinamentosContratos: TurmasAlunosTreinamentosContratos[];
}
