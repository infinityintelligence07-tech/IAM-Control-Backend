import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { Alunos } from './alunos.entity';
import { Turmas } from './turmas.entity';

@Entity('masterclass_pre_cadastros', { schema: type_schema })
export class MasterclassPreCadastros extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'id', primaryKeyConstraintName: 'pk_masterclass_pre_cadastros' })
    id: string;

    @Column({ type: 'varchar', name: 'nome_aluno', nullable: false })
    nome_aluno: string;

    @Column({ type: 'varchar', name: 'email', nullable: false })
    email: string;

    @Column({ type: 'varchar', name: 'telefone', nullable: false })
    telefone: string;

    @Column({ type: 'varchar', name: 'evento_nome', nullable: false })
    evento_nome: string;

    @Column({ type: 'date', name: 'data_evento', nullable: false })
    data_evento: Date;

    @Column({ type: 'bigint', name: 'id_turma', nullable: false })
    id_turma: number;

    @Column({ type: 'boolean', name: 'confirmou_presenca', default: false, nullable: false })
    confirmou_presenca: boolean;

    @Column({ type: 'timestamp', name: 'data_confirmacao_presenca', nullable: true })
    data_confirmacao_presenca: Date;

    @Column({ type: 'bigint', name: 'id_aluno_vinculado', nullable: true })
    id_aluno_vinculado: string;

    @Column({ type: 'timestamp', name: 'data_vinculacao_aluno', nullable: true })
    data_vinculacao_aluno: Date;

    @Column({ type: 'varchar', name: 'observacoes', nullable: true })
    observacoes: string;

    // Relacionamento com turma
    @ManyToOne(() => Turmas, { nullable: true })
    @JoinColumn([{ name: 'id_turma', referencedColumnName: 'id' }])
    id_turma_fk: Turmas;

    // Relacionamento com aluno vinculado (opcional)
    @ManyToOne(() => Alunos, (aluno) => aluno.id, { nullable: true })
    @JoinColumn([{ name: 'id_aluno_vinculado', referencedColumnName: 'id' }])
    aluno_vinculado: Alunos;
}
