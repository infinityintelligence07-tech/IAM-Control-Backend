import { Entity, Column, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { Turmas } from './turmas.entity';
import { Alunos } from './alunos.entity';
import { TurmasAlunosTreinamentosContratos } from './turmasAlunosTreinamentosContratos.entity';

@Entity('documentos', { schema: type_schema })
export class Documentos extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_documentos' })
    id: number;

    @Column({ type: 'varchar', name: 'documento', nullable: true })
    documento: string;

    @Column({ type: 'jsonb', name: 'campos_documento', nullable: true })
    campos: { campo: string; tipo: string }[];

    @Column({ type: 'text', name: 'clausulas', nullable: false })
    clausulas: string;

    @OneToMany(() => Alunos, (alunos) => alunos.id_polo_fk)
    alunos: Alunos[];

    @OneToMany(() => Turmas, (turmas) => turmas.id_polo_fk)
    turmas: Turmas[];

    @OneToMany(() => TurmasAlunosTreinamentosContratos, (turmasAlunosTreinamentosContratos) => turmasAlunosTreinamentosContratos.id_documento_fk)
    turmasAlunosTreinamentosContratos: TurmasAlunosTreinamentosContratos[];
}
