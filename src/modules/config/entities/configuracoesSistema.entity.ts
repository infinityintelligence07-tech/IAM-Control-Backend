import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';

/**
 * Armazena configurações globais do sistema no formato chave/valor.
 *
 * Usado, por exemplo, para os contatos padrão das testemunhas dos contratos
 * (e-mail e telefone), de forma que possam ser alterados pela tela de
 * configurações sem depender do aparelho/conta de quem está usando.
 */
@Entity('configuracoes_sistema', { schema: type_schema })
export class ConfiguracoesSistema extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_configuracoes_sistema' })
    id: number;

    @Index('uq_configuracoes_sistema_chave', { unique: true })
    @Column({ type: 'varchar', name: 'chave', length: 120, nullable: false })
    chave: string;

    @Column({ type: 'text', name: 'valor', nullable: true })
    valor: string | null;

    @Column({ type: 'varchar', name: 'descricao', length: 255, nullable: true })
    descricao: string | null;
}
