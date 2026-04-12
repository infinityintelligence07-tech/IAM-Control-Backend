import { Entity, Column, OneToMany, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { EOrigemAlunos, EPresencaTurmas, EStatusAlunosTurmas } from './enum/index';
import { Turmas } from './turmas.entity';
import { TurmasAlunosProdutos } from './turmasAlunosProdutos.entity';
import { Alunos } from './alunos.entity';
import { TurmasAlunosTreinamentos } from './turmasAlunosTreinamentos.entity';

@Entity('turmas_alunos', { schema: type_schema })
export class TurmasAlunos extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'id', primaryKeyConstraintName: 'pk_turmas_alunos' })
    id: string;

    @Column({ type: 'int', name: 'id_turma', nullable: false })
    id_turma: number;

    @Column({ type: 'bigint', name: 'id_aluno', nullable: true })
    id_aluno: string;

    @Column({ type: 'bigint', name: 'id_aluno_bonus', nullable: true })
    id_aluno_bonus: string;

    @Column({ type: 'varchar', name: 'url_comprovante_pgto', nullable: true })
    url_comprovante_pgto: string;

    @Column({ type: 'boolean', name: 'pendencia_pagamento', nullable: true })
    pendencia_pagamento: boolean | null;

    @Column({ type: 'boolean', name: 'contrato_duplo', nullable: true })
    contrato_duplo: boolean | null;

    @Column({ type: 'text', name: 'comprovante_pagamento_base64', nullable: true })
    comprovante_pagamento_base64: string | null;

    @Column({ type: 'enum', enum: EOrigemAlunos, enumName: 'EOrigemAlunos', name: 'origem_aluno', nullable: true })
    origem_aluno: EOrigemAlunos;

    @Column({ type: 'enum', enum: EStatusAlunosTurmas, enumName: 'EStatusAlunosTurmas', name: 'status_aluno_turma', nullable: true })
    status_aluno_turma: EStatusAlunosTurmas;

    @Column({ type: 'varchar', name: 'nome_cracha', nullable: false })
    nome_cracha: string;

    @Column({ type: 'varchar', name: 'numero_cracha', nullable: false })
    numero_cracha: string;

    @Column({ type: 'enum', enum: EPresencaTurmas, enumName: 'EPresencaTurmas', name: 'presenca_turma', nullable: true })
    presenca_turma: EPresencaTurmas;

    @Column({ type: 'boolean', name: 'vaga_bonus', default: false, nullable: false })
    vaga_bonus: boolean;

    @Column({ type: 'boolean', name: 'adquiriu_livros', default: false, nullable: false })
    adquiriu_livros: boolean;

    @Column({ type: 'boolean', name: 'adquiriu_outros_itens', default: false, nullable: false })
    adquiriu_outros_itens: boolean;

    /** Turma para a qual o aluno foi transferido (tag "Transferência Para"). O aluno permanece na turma atual com esta referência. */
    @Column({ type: 'int', name: 'id_turma_transferencia_para', nullable: true })
    id_turma_transferencia_para: number | null;

    /** Turma de onde o aluno veio por transferência (tag "Transferência De"). */
    @Column({ type: 'int', name: 'id_turma_transferencia_de', nullable: true })
    id_turma_transferencia_de: number | null;

    @ManyToOne(() => Turmas, { nullable: true })
    @JoinColumn([{ name: 'id_turma_transferencia_para', referencedColumnName: 'id' }])
    id_turma_transferencia_para_fk: Turmas | null;

    @ManyToOne(() => Turmas, { nullable: true })
    @JoinColumn([{ name: 'id_turma_transferencia_de', referencedColumnName: 'id' }])
    id_turma_transferencia_de_fk: Turmas | null;

    @ManyToOne(() => Alunos, (alunos) => alunos.turmasAlunos)
    @JoinColumn([{ name: 'id_aluno', referencedColumnName: 'id' }])
    id_aluno_fk: Alunos;

    @ManyToOne(() => Turmas, (turmas) => turmas.turmasAlunos)
    @JoinColumn([{ name: 'id_turma', referencedColumnName: 'id' }])
    id_turma_fk: Turmas;

    @OneToMany(() => TurmasAlunosProdutos, (turmasAlunosProdutos) => turmasAlunosProdutos.id_turma_aluno_fk)
    turmasAlunosProdutos: TurmasAlunosProdutos[];

    @OneToMany(() => TurmasAlunosTreinamentos, (turmasAlunosTreinamentos) => turmasAlunosTreinamentos.id_turma_aluno_fk)
    turmasAlunosTreinamentos: TurmasAlunosTreinamentos[];
}
