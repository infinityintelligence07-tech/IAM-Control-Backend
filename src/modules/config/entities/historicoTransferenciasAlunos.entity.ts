import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { Turmas } from './turmas.entity';
import { TurmasAlunos } from './turmasAlunos.entity';
import { Alunos } from './alunos.entity';

@Entity('historico_transferencias_alunos', { schema: type_schema })
export class HistoricoTransferenciasAlunos extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'id', primaryKeyConstraintName: 'pk_historico_transferencias_alunos' })
    id: string;

    @Column({ type: 'int', name: 'id_aluno', nullable: false })
    id_aluno: number;

    /** Turma de origem (de onde saiu). */
    @Column({ type: 'int', name: 'id_turma_de', nullable: false })
    id_turma_de: number;

    /** Turma de destino (para onde foi). */
    @Column({ type: 'int', name: 'id_turma_para', nullable: false })
    id_turma_para: number;

    /** Registro turmas_alunos na turma de origem (antes da transferência). */
    @Column({ type: 'bigint', name: 'id_turma_aluno_de', nullable: true })
    id_turma_aluno_de: string | null;

    /** Registro turmas_alunos criado na turma de destino. */
    @Column({ type: 'bigint', name: 'id_turma_aluno_para', nullable: true })
    id_turma_aluno_para: string | null;

    @ManyToOne(() => Alunos)
    @JoinColumn([{ name: 'id_aluno', referencedColumnName: 'id' }])
    id_aluno_fk: Alunos;

    @ManyToOne(() => Turmas)
    @JoinColumn([{ name: 'id_turma_de', referencedColumnName: 'id' }])
    id_turma_de_fk: Turmas;

    @ManyToOne(() => Turmas)
    @JoinColumn([{ name: 'id_turma_para', referencedColumnName: 'id' }])
    id_turma_para_fk: Turmas;

    @ManyToOne(() => TurmasAlunos)
    @JoinColumn([{ name: 'id_turma_aluno_de', referencedColumnName: 'id' }])
    id_turma_aluno_de_fk: TurmasAlunos | null;

    @ManyToOne(() => TurmasAlunos)
    @JoinColumn([{ name: 'id_turma_aluno_para', referencedColumnName: 'id' }])
    id_turma_aluno_para_fk: TurmasAlunos | null;
}
