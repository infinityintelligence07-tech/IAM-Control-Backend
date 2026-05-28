import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { Turmas } from './turmas.entity';
import { TurmasAlunos } from './turmasAlunos.entity';
import { Alunos } from './alunos.entity';

@Entity('historico_alunos_turmas_logs', { schema: type_schema })
export class HistoricoAlunosTurmasLog extends BaseEntity {
    @PrimaryGeneratedColumn('increment', {
        type: 'bigint',
        name: 'id',
        primaryKeyConstraintName: 'pk_historico_alunos_turmas_logs',
    })
    id: string;

    @Column({ type: 'bigint', name: 'id_turma_aluno', nullable: false })
    id_turma_aluno: string;

    @Column({ type: 'int', name: 'id_turma', nullable: false })
    id_turma: number;

    @Column({ type: 'bigint', name: 'id_aluno', nullable: false })
    id_aluno: string;

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

    @ManyToOne(() => TurmasAlunos)
    @JoinColumn([{ name: 'id_turma_aluno', referencedColumnName: 'id' }])
    id_turma_aluno_fk: TurmasAlunos;

    @ManyToOne(() => Turmas)
    @JoinColumn([{ name: 'id_turma', referencedColumnName: 'id' }])
    id_turma_fk: Turmas;

    @ManyToOne(() => Alunos)
    @JoinColumn([{ name: 'id_aluno', referencedColumnName: 'id' }])
    id_aluno_fk: Alunos;
}
