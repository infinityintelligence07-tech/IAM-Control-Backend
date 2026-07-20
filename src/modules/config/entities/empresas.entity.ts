import { Entity, Column, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { Treinamentos } from './treinamentos.entity';

/**
 * Empresas do grupo (ex.: IAM e Liberty). Cada treinamento pode ser vinculado a
 * uma empresa (`treinamentos.id_empresa`), permitindo a visualização/filtragem
 * do sistema por empresa. A empresa é classificação/visualização: nenhuma regra
 * de venda restringe vender treinamento de uma empresa durante o evento de outra.
 */
@Entity('empresas', { schema: type_schema })
export class Empresas extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_empresas' })
    id: number;

    @Column({ type: 'varchar', name: 'nome', nullable: false, unique: true })
    nome: string;

    @Column({ type: 'varchar', name: 'sigla', nullable: true })
    sigla: string | null;

    @Column({ type: 'text', name: 'url_logo', nullable: true })
    url_logo: string | null;

    @OneToMany(() => Treinamentos, (treinamento) => treinamento.id_empresa_fk)
    treinamentos: Treinamentos[];
}
