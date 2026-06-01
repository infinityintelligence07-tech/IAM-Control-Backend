import { Entity, Column, PrimaryGeneratedColumn, OneToOne, JoinColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { Turmas } from './turmas.entity';

@Entity('turmas_metricas_snapshot', { schema: type_schema })
export class TurmasMetricasSnapshot extends BaseEntity {
    @PrimaryGeneratedColumn('increment', {
        type: 'bigint',
        name: 'id',
        primaryKeyConstraintName: 'pk_turmas_metricas_snapshot',
    })
    id: string;

    @Column({ type: 'int', name: 'id_turma', nullable: false, unique: true })
    id_turma: number;

    @Column({ type: 'timestamp', name: 'snapshot_em', nullable: false, default: () => 'now()' })
    snapshot_em: Date;

    @Column({ type: 'jsonb', name: 'resumo', nullable: false, default: () => "'{}'::jsonb" })
    resumo: Record<string, unknown>;

    @Column({ type: 'jsonb', name: 'alunos_por_tipo', nullable: false, default: () => "'{}'::jsonb" })
    alunos_por_tipo: Record<string, unknown>;

    @OneToOne(() => Turmas)
    @JoinColumn([{ name: 'id_turma', referencedColumnName: 'id' }])
    id_turma_fk: Turmas;
}
