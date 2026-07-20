import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';

export type DuvidasSugestaoStatus = 'pendente' | 'aprovada' | 'rejeitada';

@Entity('duvidas_sugestoes', { schema: type_schema })
export class DuvidasSugestoes extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_duvidas_sugestoes' })
    id: number;

    @Column({ type: 'text', name: 'pergunta', nullable: false })
    pergunta: string;

    @Column({ type: 'text', name: 'resposta_proposta', nullable: false })
    resposta_proposta: string;

    @Column({ type: 'text', name: 'conteudo_md_proposto', nullable: false })
    conteudo_md_proposto: string;

    @Column({ type: 'varchar', name: 'titulo_proposto', length: 500, nullable: true })
    titulo_proposto: string | null;

    @Index('idx_duvidas_sugestoes_status')
    @Column({ type: 'varchar', name: 'status', length: 20, nullable: false, default: 'pendente' })
    status: DuvidasSugestaoStatus;

    @Column({ type: 'int', name: 'id_conversa', nullable: true })
    id_conversa: number | null;

    @Column({ type: 'int', name: 'id_mensagem', nullable: true })
    id_mensagem: number | null;

    /** Artigo criado após aprovação. */
    @Column({ type: 'int', name: 'id_artigo', nullable: true })
    id_artigo: number | null;
}
