import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { TurmasAlunos } from './turmasAlunos.entity';
import { Produtos } from './produtos.entity';
import { EFormasPagamento } from './enum';

@Entity('turmas_alunos_produtos', { schema: type_schema })
export class TurmasAlunosProdutos extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'id', primaryKeyConstraintName: 'pk_turmas_alunos_prd' })
    id: string;

    @Column({ type: 'bigint', name: 'id_turma_aluno', nullable: false })
    id_turma_aluno: string;

    @Column({ type: 'int', name: 'id_produto', nullable: false })
    id_produto: number;

    @Column({ type: 'int', name: 'quantidade', nullable: false })
    quantidade: number;

    @Column({ type: 'float', name: 'preco_produto_evento', nullable: false })
    preco_produto_evento: number;

    @Column({ type: 'float', name: 'subtotal', nullable: false })
    subtotal: number;

    @Column({ type: 'enum', enum: EFormasPagamento, enumName: 'EFormasPagamento', name: 'forma_pgto', nullable: false })
    forma_pgto: EFormasPagamento;

    @ManyToOne(() => TurmasAlunos, (turmasAlunos) => turmasAlunos.turmasAlunosProdutos)
    @JoinColumn([{ name: 'id_turma_aluno', referencedColumnName: 'id' }])
    id_turma_aluno_fk: TurmasAlunos;

    @ManyToOne(() => Produtos, (produtos) => produtos.turmasAlunosProdutos)
    @JoinColumn([{ name: 'id_produto', referencedColumnName: 'id' }])
    id_produto_fk: Produtos;
}
