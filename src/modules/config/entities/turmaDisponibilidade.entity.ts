import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { Turmas } from './turmas.entity';

@Entity('turma_disponibilidade', { schema: type_schema })
export class TurmaDisponibilidade extends BaseEntity {
    @PrimaryGeneratedColumn('increment', {
        type: 'int',
        name: 'id',
        primaryKeyConstraintName: 'pk_turma_disponibilidade',
    })
    id: number;

    @Index('idx_turma_disponibilidade_id_turma')
    @Column({ type: 'int', name: 'id_turma', nullable: false })
    id_turma: number;

    @Index('idx_turma_disponibilidade_data_hora')
    @Column({ type: 'timestamp', name: 'data_hora', nullable: false })
    data_hora: Date;

    @Column({ type: 'int', name: 'qtd_manha', nullable: false, default: 0 })
    qtd_manha: number;

    @Column({ type: 'int', name: 'qtd_tarde', nullable: false, default: 0 })
    qtd_tarde: number;

    @Column({ type: 'int', name: 'qtd_noite', nullable: false, default: 0 })
    qtd_noite: number;

    @Column({ type: 'int', name: 'qtd_fila_pitch', nullable: false, default: 0 })
    qtd_fila_pitch: number;

    @Column({ type: 'int', name: 'qtd_fila_repitch', nullable: false, default: 0 })
    qtd_fila_repitch: number;

    @Column({ type: 'varchar', name: 'observacao', nullable: true })
    observacao: string | null;

    @ManyToOne(() => Turmas, { nullable: false })
    @JoinColumn({
        name: 'id_turma',
        foreignKeyConstraintName: 'fk_turma_disponibilidade_turma',
    })
    turma: Turmas;
}
