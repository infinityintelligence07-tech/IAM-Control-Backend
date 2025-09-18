import { Entity, Column, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { ETiposProdutos } from './enum/index';
import { TurmasAlunosProdutos } from './turmasAlunosProdutos.entity';

@Entity('produtos', { schema: type_schema })
export class Produtos extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_produtos' })
    id: number;

    @Column({ type: 'varchar', name: 'produto', nullable: false })
    produto: string;

    @Column({ type: 'enum', enum: ETiposProdutos, enumName: 'ETiposProdutos', name: 'tipo_produto', default: ETiposProdutos.OUTRO, nullable: false })
    tipo_produto: ETiposProdutos;

    @Column({ type: 'float', name: 'preco', nullable: false })
    preco: number;

    @OneToMany(() => TurmasAlunosProdutos, (turmasAlunosProdutos) => turmasAlunosProdutos.id_produto_fk)
    turmasAlunosProdutos: TurmasAlunosProdutos[];
}
