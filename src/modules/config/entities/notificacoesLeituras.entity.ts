import { Entity, Column, PrimaryGeneratedColumn, Index, ManyToOne, JoinColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { Notificacoes } from './notificacoes.entity';
import { Usuarios } from './usuarios.entity';

/**
 * Registro de leitura de notificação por usuário (permite histórico de
 * notificações lidas/não lidas individual para cada membro do setor).
 */
@Entity('notificacoes_leituras', { schema: type_schema })
@Index('uq_notificacoes_leituras_notificacao_usuario', ['id_notificacao', 'id_usuario'], { unique: true })
export class NotificacoesLeituras extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_notificacoes_leituras' })
    id: number;

    @Column({ type: 'int', name: 'id_notificacao', nullable: false })
    id_notificacao: number;

    @Index('idx_notificacoes_leituras_usuario')
    @Column({ type: 'int', name: 'id_usuario', nullable: false })
    id_usuario: number;

    @ManyToOne(() => Notificacoes)
    @JoinColumn([{ name: 'id_notificacao', referencedColumnName: 'id' }])
    id_notificacao_fk: Notificacoes;

    @ManyToOne(() => Usuarios)
    @JoinColumn([{ name: 'id_usuario', referencedColumnName: 'id' }])
    id_usuario_fk: Usuarios;
}
