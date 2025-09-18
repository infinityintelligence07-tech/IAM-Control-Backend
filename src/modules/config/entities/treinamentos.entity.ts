import { Entity, Column, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { Turmas } from './turmas.entity';
import { TurmasAlunosTreinamentos } from './turmasAlunosTreinamentos.entity';
import { TurmasAlunosTreinamentosBonus } from './turmasAlunosTreinamentosBonus.entity';

@Entity('treinamentos', { schema: type_schema })
export class Treinamentos extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_treinamentos' })
    id: number;

    @Column({ type: 'varchar', name: 'treinamento', nullable: false })
    treinamento: string;

    @Column({ type: 'varchar', name: 'sigla_treinamento', nullable: true })
    sigla_treinamento: string;

    @Column({ type: 'float', name: 'preco_treinamento', nullable: false })
    preco_treinamento: number;

    @Column({ type: 'varchar', name: 'url_logo_treinamento', nullable: true })
    url_logo_treinamento: string;

    @Column({ type: 'boolean', name: 'tipo_treinamento', nullable: false })
    tipo_treinamento: boolean;

    @Column({ type: 'boolean', name: 'tipo_palestra', nullable: false })
    tipo_palestra: boolean;

    @Column({ type: 'boolean', name: 'tipo_online', nullable: false })
    tipo_online: boolean;

    @OneToMany(() => Turmas, (turmas) => turmas.id_polo_fk)
    turmas: Turmas[];

    @OneToMany(() => TurmasAlunosTreinamentos, (turmasAlunosTreinamentos) => turmasAlunosTreinamentos.id_treinamento_fk)
    turmasAlunosTreinamentos: TurmasAlunosTreinamentos[];
}
