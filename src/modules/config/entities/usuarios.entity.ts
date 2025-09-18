import { Entity, Column, PrimaryGeneratedColumn, OneToMany } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { EFuncoes, ESetores } from './enum/index';
import { Turmas } from './turmas.entity';
import { TurmasAlunosTreinamentosContratos } from './turmasAlunosTreinamentosContratos.entity';
import { PasswordRecoveryTokens } from './passwordRecoveryTokens.entity';

@Entity('usuarios', { schema: type_schema })
export class Usuarios extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_usuarios' })
    id: number;

    @Column({ type: 'varchar', name: 'nome', nullable: false })
    nome: string;

    @Column({ type: 'varchar', name: 'primeiro_nome', nullable: false })
    primeiro_nome: string;

    @Column({ type: 'varchar', name: 'sobrenome', nullable: false })
    sobrenome: string;

    @Column({ type: 'varchar', name: 'email', nullable: false, unique: true })
    email: string;

    @Column({ type: 'varchar', name: 'senha', nullable: false })
    senha: string;

    @Column({ type: 'enum', enum: ESetores, enumName: 'ESetores', name: 'setor', default: ESetores.CUIDADO_DE_ALUNOS, nullable: false })
    setor: ESetores;

    @Column({ type: 'enum', enum: EFuncoes, enumName: 'EFuncoes', name: 'funcao', default: EFuncoes.COLABORADOR, nullable: false })
    funcao: EFuncoes;

    @Column({ type: 'varchar', name: 'telefone', nullable: false })
    telefone: string;

    @Column({ type: 'varchar', name: 'url_foto', nullable: true })
    url_foto: string;

    @OneToMany(() => Turmas, (turmas) => turmas.lider_evento_fk)
    turmas: Turmas[];

    @OneToMany(() => PasswordRecoveryTokens, (passwordRecoveryTokens) => passwordRecoveryTokens.usuario_fk)
    passwordRecoveryTokens: PasswordRecoveryTokens[];

    @OneToMany(() => TurmasAlunosTreinamentosContratos, (turmasAlunosTreinamentosContratos) => turmasAlunosTreinamentosContratos.testemunha_um_fk)
    turmasAlunosTreinamentosContratos_t_um: TurmasAlunosTreinamentosContratos[];

    @OneToMany(() => TurmasAlunosTreinamentosContratos, (turmasAlunosTreinamentosContratos) => turmasAlunosTreinamentosContratos.testemunha_dois_fk)
    turmasAlunosTreinamentosContratos_t_dois: TurmasAlunosTreinamentosContratos[];
}
