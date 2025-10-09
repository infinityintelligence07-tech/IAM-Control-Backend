import { Entity, Column, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { Turmas } from './turmas.entity';
import { Alunos } from './alunos.entity';
import { TurmasAlunosTreinamentosContratos } from './turmasAlunosTreinamentosContratos.entity';
import { ETipoDocumento } from './enum';

@Entity('documentos', { schema: type_schema })
export class Documentos extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_documentos' })
    id: number;

    @Column({ type: 'varchar', name: 'documento', nullable: true })
    documento: string;

    @Column({ type: 'enum', enum: ETipoDocumento, name: 'tipo_documento', nullable: false })
    tipo_documento: ETipoDocumento;

    @Column({ type: 'jsonb', name: 'campos_documento', nullable: true })
    campos: { campo: string; tipo: string; descricao?: string; opcoes?: string[] }[];

    @Column({ type: 'text', name: 'clausulas', nullable: false })
    clausulas: string;

    @Column({ type: 'jsonb', name: 'treinamentos_relacionados', nullable: true })
    treinamentos_relacionados: number[];

    @OneToMany(() => Alunos, (alunos) => alunos.id_polo_fk)
    alunos: Alunos[];

    @OneToMany(() => Turmas, (turmas) => turmas.id_polo_fk)
    turmas: Turmas[];

    @OneToMany(() => TurmasAlunosTreinamentosContratos, (turmasAlunosTreinamentosContratos) => turmasAlunosTreinamentosContratos.id_documento_fk)
    turmasAlunosTreinamentosContratos: TurmasAlunosTreinamentosContratos[];
}
