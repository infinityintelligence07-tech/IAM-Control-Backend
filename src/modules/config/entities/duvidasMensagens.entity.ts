import { Entity, Column, PrimaryGeneratedColumn, Index, ManyToOne, JoinColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { DuvidasConversas } from './duvidasConversas.entity';

export type DuvidasMensagemRole = 'user' | 'assistant';

@Entity('duvidas_mensagens', { schema: type_schema })
export class DuvidasMensagens extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_duvidas_mensagens' })
    id: number;

    @Index('idx_duvidas_mensagens_conversa')
    @Column({ type: 'int', name: 'id_conversa', nullable: false })
    id_conversa: number;

    @Column({ type: 'varchar', name: 'role', length: 20, nullable: false })
    role: DuvidasMensagemRole;

    @Column({ type: 'text', name: 'conteudo', nullable: false })
    conteudo: string;

    /** Fontes citadas pelo assistente (ids/títulos dos artigos). */
    @Column({ type: 'jsonb', name: 'fontes', nullable: true })
    fontes: Array<{ id: number; titulo: string; caminho_origem?: string | null }> | null;

    /** Indica se o assistente detectou lacuna na base documental. */
    @Column({ type: 'boolean', name: 'lacuna_detectada', nullable: false, default: false })
    lacuna_detectada: boolean;

    @ManyToOne(() => DuvidasConversas, (c) => c.mensagens, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'id_conversa', foreignKeyConstraintName: 'fk_duvidas_mensagens_conversa' })
    conversa?: DuvidasConversas;
}
