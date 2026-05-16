import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';

@Entity('historico_sorteados', { schema: type_schema })
export class HistoricoSorteados extends BaseEntity {
    @PrimaryGeneratedColumn('increment', {
        type: 'bigint',
        name: 'id',
        primaryKeyConstraintName: 'pk_historico_sorteados',
    })
    id: string;

    @Column({ type: 'bigint', name: 'id_turma_aluno', nullable: false })
    id_turma_aluno: string;

    @Column({ type: 'int', name: 'id_turma', nullable: false })
    id_turma: number;

    @Column({ type: 'int', name: 'id_presente_sorteio', nullable: false })
    id_presente_sorteio: number;

    @Column({ type: 'varchar', name: 'numero_cracha', nullable: false })
    numero_cracha: string;

    @Column({ type: 'timestamp', name: 'sorteado_em', nullable: false, default: () => 'CURRENT_TIMESTAMP' })
    sorteado_em: Date;

    @Column({ type: 'text', name: 'observacao', nullable: true })
    observacao?: string | null;
}
