import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';

/**
 * Notificações internas do sistema direcionadas a um setor (ex.: Cuidado de Alunos).
 *
 * Caso de uso principal: quando um contrato é excluído no Histórico de Vendas,
 * os alunos/bônus lançados nas turmas NÃO são mais removidos automaticamente —
 * em vez disso, uma notificação é criada para o time do Cuidado de Alunos avaliar
 * e tratar manualmente. O estado de leitura é por usuário (NotificacoesLeituras).
 */
@Entity('notificacoes', { schema: type_schema })
export class Notificacoes extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_notificacoes' })
    id: number;

    @Column({ type: 'varchar', name: 'tipo', length: 60, nullable: false })
    tipo: string;

    @Column({ type: 'varchar', name: 'titulo', length: 255, nullable: false })
    titulo: string;

    @Column({ type: 'text', name: 'mensagem', nullable: false })
    mensagem: string;

    /** Setor destinatário da notificação (valor de ESetores, ex.: CUIDADO_DE_ALUNOS). */
    @Index('idx_notificacoes_setor_destino')
    @Column({ type: 'varchar', name: 'setor_destino', length: 60, nullable: false })
    setor_destino: string;

    /**
     * Destinatário INDIVIDUAL (opcional). Quando preenchido, a notificação é
     * visível apenas para este usuário (não para todo o `setor_destino`) — usado
     * nas mudanças de venda, que vão só para a líder do Cuidado de Alunos e para
     * a acessora da turma de destino.
     */
    @Index('idx_notificacoes_usuario_destino')
    @Column({ type: 'int', name: 'id_usuario_destino', nullable: true })
    id_usuario_destino: number | null;

    /** Dados estruturados adicionais (ex.: ids do contrato/aluno/turmas envolvidos). */
    @Column({ type: 'jsonb', name: 'dados', nullable: true })
    dados: Record<string, unknown> | null;
}
