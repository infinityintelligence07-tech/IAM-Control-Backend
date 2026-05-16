import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { TurmasAlunos } from './turmasAlunos.entity';
import { Turmas } from './turmas.entity';
import { TurmasAlunosTreinamentos } from './turmasAlunosTreinamentos.entity';

@Entity('turmas_alunos_treinamentos_bonus', { schema: type_schema })
export class TurmasAlunosTreinamentosBonus extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'id', primaryKeyConstraintName: 'pk_turmas_alunos_trn_brn' })
    id: string;

    @Column({ type: 'bigint', name: 'id_turma_aluno', nullable: false })
    id_turma_aluno: string;

    @Column({ type: 'bigint', name: 'id_turma_aluno_treinamento', nullable: true })
    id_turma_aluno_treinamento: string | null;

    @Column({ type: 'bigint', name: 'id_turma_bonus', nullable: true })
    id_turma_bonus: string | null;

    @Column({ type: 'varchar', length: 64, name: 'tipo_bonus', nullable: true })
    tipo_bonus: string | null;

    @Column({ type: 'jsonb', array: true, name: 'ganhadores_bonus', nullable: false })
    ganhadores_bonus: { nome: string; telefone: string; email: string; id_turma_gb: number; id_treinamento_gb: number }[];

    @ManyToOne(() => TurmasAlunos, (turmasAlunos) => turmasAlunos.turmasAlunosTreinamentos)
    @JoinColumn([{ name: 'id_turma_aluno', referencedColumnName: 'id' }])
    id_turma_aluno_fk: TurmasAlunos;

    @ManyToOne(() => TurmasAlunosTreinamentos, { nullable: true, onDelete: 'CASCADE' })
    @JoinColumn([{ name: 'id_turma_aluno_treinamento', referencedColumnName: 'id' }])
    id_turma_aluno_treinamento_fk: TurmasAlunosTreinamentos | null;

    @ManyToOne(() => Turmas, { nullable: true, onDelete: 'SET NULL' })
    @JoinColumn([{ name: 'id_turma_bonus', referencedColumnName: 'id' }])
    id_turma_bonus_fk: Turmas | null;
}
