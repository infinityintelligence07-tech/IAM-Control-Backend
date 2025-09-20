import { Entity, Column, PrimaryGeneratedColumn, OneToMany, ManyToOne, JoinColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { TurmasAlunos } from './turmasAlunos.entity';
import { EStatusAlunosGeral } from './enum';
import { Polos } from './polos.entity';
import { MasterclassPreCadastros } from './masterclassPreCadastros.entity';

@Entity('alunos', { schema: type_schema })
export class Alunos extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_alunos' })
    id: number;

    @Column({ type: 'int', name: 'id_polo', nullable: false })
    id_polo: number;

    @Column({ type: 'varchar', name: 'nome', nullable: false })
    nome: string;

    @Column({ type: 'varchar', name: 'nome_cracha', nullable: false })
    nome_cracha: string;

    @Column({ type: 'varchar', name: 'email', nullable: false, unique: true })
    email: string;

    @Column({ type: 'varchar', name: 'senha', nullable: true })
    senha: string;

    @Column({ type: 'varchar', name: 'genero', nullable: true })
    genero: string;

    @Column({ type: 'varchar', name: 'cpf', nullable: true })
    cpf: string;

    @Column({ type: 'varchar', name: 'data_nascimento', nullable: true })
    data_nascimento: string;

    @Column({ type: 'varchar', name: 'telefone_um', nullable: false })
    telefone_um: string;

    @Column({ type: 'varchar', name: 'telefone_dois', nullable: true })
    telefone_dois: string;

    @Column({ type: 'varchar', name: 'cep', nullable: true })
    cep: string;

    @Column({ type: 'varchar', name: 'logradouro', nullable: true })
    logradouro: string;

    @Column({ type: 'varchar', name: 'complemento', nullable: true })
    complemento: string;

    @Column({ type: 'varchar', name: 'numero', nullable: true })
    numero: string;

    @Column({ type: 'varchar', name: 'bairro', nullable: true })
    bairro: string;

    @Column({ type: 'varchar', name: 'cidade', nullable: true })
    cidade: string;

    @Column({ type: 'varchar', name: 'estado', nullable: true })
    estado: string;

    @Column({ type: 'varchar', name: 'profissao', nullable: true })
    profissao: string;

    @Column({
        type: 'enum',
        enum: EStatusAlunosGeral,
        enumName: 'EStatusAlunosGeral',
        name: 'status_aluno_geral',
        default: EStatusAlunosGeral.PENDENTE,
        nullable: true,
    })
    status_aluno_geral: EStatusAlunosGeral;

    @Column({ type: 'boolean', name: 'possui_deficiencia', nullable: false })
    possui_deficiencia: boolean;

    @Column({ type: 'varchar', name: 'desc_deficiencia', nullable: true })
    desc_deficiencia: string;

    @Column({ type: 'varchar', name: 'url_foto_aluno', nullable: true })
    url_foto_aluno: string;

    @ManyToOne(() => Polos, (polos) => polos.alunos)
    @JoinColumn([{ name: 'id_polo', referencedColumnName: 'id' }])
    id_polo_fk: Polos;

    @OneToMany(() => TurmasAlunos, (turmasAlunos) => turmasAlunos.id_aluno_fk)
    turmasAlunos: TurmasAlunos[];

    @OneToMany(() => MasterclassPreCadastros, (masterclassPreCadastros) => masterclassPreCadastros.id_aluno_vinculado)
    masterclassPreCadastros: MasterclassPreCadastros[];
}
