import { Entity, Column, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { Turmas } from './turmas.entity';
import { Alunos } from './alunos.entity';

@Entity('polos', { schema: type_schema })
export class Polos extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_polos' })
    id: number;

    @Column({ type: 'varchar', name: 'sigla_polo', nullable: false })
    sigla_polo: string;

    @Column({ type: 'varchar', name: 'polo', nullable: false })
    polo: string;

    @Column({ type: 'varchar', name: 'cidade', nullable: false })
    cidade: string;

    @Column({ type: 'varchar', name: 'estado', nullable: false })
    estado: string;

    @OneToMany(() => Alunos, (alunos) => alunos.id_polo_fk)
    alunos: Alunos[];

    @OneToMany(() => Turmas, (turmas) => turmas.id_polo_fk)
    turmas: Turmas[];
}
