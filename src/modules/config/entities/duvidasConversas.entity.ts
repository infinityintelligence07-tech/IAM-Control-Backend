import { Entity, Column, PrimaryGeneratedColumn, Index, OneToMany } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { DuvidasMensagens } from './duvidasMensagens.entity';

@Entity('duvidas_conversas', { schema: type_schema })
export class DuvidasConversas extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_duvidas_conversas' })
    id: number;

    @Index('idx_duvidas_conversas_usuario')
    @Column({ type: 'int', name: 'id_usuario', nullable: false })
    id_usuario: number;

    @Column({ type: 'varchar', name: 'titulo', length: 255, nullable: true })
    titulo: string | null;

    @OneToMany(() => DuvidasMensagens, (m) => m.conversa)
    mensagens?: DuvidasMensagens[];
}
