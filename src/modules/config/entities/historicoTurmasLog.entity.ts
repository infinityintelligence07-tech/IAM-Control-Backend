import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { Turmas } from './turmas.entity';

/**
 * Log de alterações de uma turma/evento (criação, edição, mudança de status,
 * remoção, importação via webhook e observações manuais). Espelha a ideia do
 * histórico de aluno (historico_alunos_turmas_logs), porém no nível da turma.
 */
@Entity('historico_turmas_logs', { schema: type_schema })
export class HistoricoTurmasLog extends BaseEntity {
    @PrimaryGeneratedColumn('increment', {
        type: 'bigint',
        name: 'id',
        primaryKeyConstraintName: 'pk_historico_turmas_logs',
    })
    id: string;

    @Index('idx_historico_turmas_logs_id_turma')
    @Column({ type: 'int', name: 'id_turma', nullable: false })
    id_turma: number;

    @Column({ type: 'varchar', name: 'tipo_acao', length: 50, nullable: false })
    tipo_acao: string;

    @Column({ type: 'varchar', name: 'titulo', length: 255, nullable: false })
    titulo: string;

    @Column({ type: 'text', name: 'descricao', nullable: true })
    descricao: string | null;

    @Column({ type: 'varchar', name: 'template_key', length: 100, nullable: true })
    template_key: string | null;

    @Column({ type: 'jsonb', name: 'detalhes', nullable: false, default: () => "'{}'::jsonb" })
    detalhes: Record<string, unknown>;

    @Column({ type: 'timestamp', name: 'data_acao', nullable: false, default: () => 'now()' })
    data_acao: Date;

    @ManyToOne(() => Turmas)
    @JoinColumn([{ name: 'id_turma', referencedColumnName: 'id' }])
    id_turma_fk: Turmas;
}
