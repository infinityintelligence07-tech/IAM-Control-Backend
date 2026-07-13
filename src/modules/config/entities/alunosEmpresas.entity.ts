import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { Alunos } from './alunos.entity';

@Entity('alunos_empresas', { schema: type_schema })
export class AlunosEmpresas extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_alunos_empresas' })
    id: number;

    @Column({ type: 'int', name: 'id_aluno', nullable: false })
    id_aluno: number;

    @Column({ type: 'varchar', name: 'cnpj', nullable: false })
    cnpj: string;

    @Column({ type: 'varchar', name: 'razao_social', nullable: false })
    razao_social: string;

    @Column({ type: 'varchar', name: 'nome_fantasia', nullable: true })
    nome_fantasia: string | null;

    @Column({ type: 'varchar', name: 'email', nullable: true })
    email: string | null;

    @Column({ type: 'varchar', name: 'telefone', nullable: true })
    telefone: string | null;

    @Column({ type: 'varchar', name: 'cep', nullable: true })
    cep: string | null;

    @Column({ type: 'varchar', name: 'logradouro', nullable: true })
    logradouro: string | null;

    @Column({ type: 'varchar', name: 'numero', nullable: true })
    numero: string | null;

    @Column({ type: 'varchar', name: 'complemento', nullable: true })
    complemento: string | null;

    @Column({ type: 'varchar', name: 'bairro', nullable: true })
    bairro: string | null;

    @Column({ type: 'varchar', name: 'cidade', nullable: true })
    cidade: string | null;

    @Column({ type: 'varchar', name: 'estado', nullable: true })
    estado: string | null;

    @ManyToOne(() => Alunos, (aluno) => aluno.empresas, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn([{ name: 'id_aluno', referencedColumnName: 'id' }])
    id_aluno_fk: Alunos;
}
