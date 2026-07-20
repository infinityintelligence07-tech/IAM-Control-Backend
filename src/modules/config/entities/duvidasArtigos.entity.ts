import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';

export type DuvidasArtigoStatus = 'publicado' | 'arquivado';

@Entity('duvidas_artigos', { schema: type_schema })
export class DuvidasArtigos extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_duvidas_artigos' })
    id: number;

    @Column({ type: 'varchar', name: 'titulo', length: 500, nullable: false })
    titulo: string;

    @Index('uq_duvidas_artigos_slug', { unique: true })
    @Column({ type: 'varchar', name: 'slug', length: 500, nullable: false })
    slug: string;

    @Column({ type: 'text', name: 'conteudo_md', nullable: false })
    conteudo_md: string;

    /** Caminho relativo no vault Obsidian (ex.: Processos/Onboarding.md). */
    @Index('uq_duvidas_artigos_caminho_origem', { unique: true })
    @Column({ type: 'varchar', name: 'caminho_origem', length: 1000, nullable: true })
    caminho_origem: string | null;

    @Column({ type: 'varchar', name: 'status', length: 20, nullable: false, default: 'publicado' })
    status: DuvidasArtigoStatus;

    @Column({ type: 'jsonb', name: 'tags', nullable: true })
    tags: string[] | null;
}
