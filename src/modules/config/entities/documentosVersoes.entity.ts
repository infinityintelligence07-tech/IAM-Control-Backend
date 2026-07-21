import { Entity, Column, ManyToOne, JoinColumn, PrimaryGeneratedColumn, Index } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { Documentos } from './documentos.entity';

/**
 * Snapshot de uma versão anterior de um documento (modelo de contrato/termo).
 * A cada edição do documento, o estado ANTERIOR é arquivado aqui, permitindo
 * consultar o histórico de alterações e restaurar versões antigas.
 */
@Entity('documentos_versoes', { schema: type_schema })
export class DocumentosVersoes extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_documentos_versoes' })
    id: number;

    @Index('idx_documentos_versoes_id_documento')
    @Column({ type: 'int', name: 'id_documento', nullable: false })
    id_documento: number;

    // Número da versão arquivada (a versão vigente fica em documentos.versao).
    @Column({ type: 'int', name: 'versao', nullable: false })
    versao: number;

    @Column({ type: 'varchar', name: 'documento', nullable: true })
    documento: string;

    // Snapshot: varchar (não enum) para manter a migração simples.
    @Column({ type: 'varchar', name: 'tipo_documento', nullable: true })
    tipo_documento: string;

    @Column({ type: 'jsonb', name: 'campos_documento', nullable: true })
    campos: { campo: string; tipo: string; descricao?: string; opcoes?: string[] }[];

    @Column({ type: 'text', name: 'clausulas', nullable: true })
    clausulas: string;

    @Column({ type: 'jsonb', name: 'treinamentos_relacionados', nullable: true })
    treinamentos_relacionados: number[];

    // Quem e quando produziu o CONTEÚDO desta versão (copiado de
    // documentos.atualizado_em/atualizado_por no momento do arquivamento).
    @Column({ type: 'timestamp', name: 'conteudo_alterado_em', nullable: true })
    conteudo_alterado_em: Date | null;

    @Column({ type: 'int', name: 'conteudo_alterado_por', nullable: true })
    conteudo_alterado_por: number | null;

    @ManyToOne(() => Documentos)
    @JoinColumn([{ name: 'id_documento', referencedColumnName: 'id' }])
    id_documento_fk: Documentos;
}
