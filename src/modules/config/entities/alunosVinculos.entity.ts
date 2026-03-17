import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { ETipoVinculoAluno } from './enum';
import { Alunos } from './alunos.entity';
import { Treinamentos } from './treinamentos.entity';

@Entity('alunos_vinculos', { schema: type_schema })
export class AlunosVinculos extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_alunos_vinculos' })
    id: number;

    @Column({ type: 'int', name: 'id_aluno', nullable: false })
    id_aluno: number;

    @Column({ type: 'enum', enum: ETipoVinculoAluno, enumName: 'ETipoVinculoAluno', name: 'tipo_vinculo', nullable: false })
    tipo_vinculo: ETipoVinculoAluno;

    @Column({ type: 'int', name: 'id_aluno_vinculado', nullable: false })
    id_aluno_vinculado: number;

    @Column({ type: 'int', name: 'id_treinamento', nullable: true })
    id_treinamento: number | null;

    @ManyToOne(() => Alunos, (aluno) => aluno.vinculos, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn([{ name: 'id_aluno', referencedColumnName: 'id' }])
    id_aluno_fk: Alunos;

    @ManyToOne(() => Alunos, { nullable: false })
    @JoinColumn([{ name: 'id_aluno_vinculado', referencedColumnName: 'id' }])
    id_aluno_vinculado_fk: Alunos;

    @ManyToOne(() => Treinamentos, { nullable: true })
    @JoinColumn([{ name: 'id_treinamento', referencedColumnName: 'id' }])
    id_treinamento_fk: Treinamentos | null;
}
