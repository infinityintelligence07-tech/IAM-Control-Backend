import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { Polos } from './polos.entity';
import { Treinamentos } from './treinamentos.entity';
import { EStatusTurmas } from './enum/index';
import { TurmasAlunos } from './turmasAlunos.entity';
import { Usuarios } from './usuarios.entity';
import { TurmasAlunosTreinamentosBonus } from './turmasAlunosTreinamentosBonus.entity';
import { MasterclassPreCadastros } from './masterclassPreCadastros.entity';
import { EnderecoEventos } from './enderecoEventos.entity';

@Entity('turmas', { schema: type_schema })
export class Turmas extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_turmas' })
    id: number;

    @Column({ type: 'int', name: 'id_polo', nullable: false })
    id_polo: number;

    @Column({ type: 'int', name: 'id_treinamento', nullable: false })
    id_treinamento: number;

    @Column({ type: 'int', name: 'lider_evento', nullable: true })
    lider_evento: number;

    @Column({ type: 'varchar', name: 'edicao_turma', nullable: true })
    edicao_turma: string;

    @Column({ type: 'varchar', name: 'cep', nullable: false })
    cep: string;

    @Column({ type: 'varchar', name: 'logradouro', nullable: false })
    logradouro: string;

    @Column({ type: 'varchar', name: 'complemento', nullable: true })
    complemento: string;

    @Column({ type: 'varchar', name: 'numero', nullable: false })
    numero: string;

    @Column({ type: 'varchar', name: 'bairro', nullable: false })
    bairro: string;

    @Column({ type: 'varchar', name: 'cidade', nullable: true })
    cidade: string;

    @Column({ type: 'varchar', name: 'estado', nullable: true })
    estado: string;

    @Column({ type: 'int', name: 'id_endereco_evento', nullable: true })
    id_endereco_evento: number;

    @Column({ type: 'enum', enum: EStatusTurmas, enumName: 'EStatusTurmas', name: 'status_turma', default: EStatusTurmas.AGUARDANDO_LIBERACAO, nullable: false })
    status_turma: EStatusTurmas;

    @Column({ type: 'boolean', name: 'autorizar_bonus', default: false, nullable: false })
    autorizar_bonus: boolean;

    @Column({ type: 'int', name: 'id_turma_bonus', nullable: true })
    id_turma_bonus: number;

    @Column({ type: 'int', name: 'capacidade_turma', nullable: false })
    capacidade_turma: number;

    @Column({ type: 'int', name: 'meta', nullable: true })
    meta: number;

    @Column({ type: 'date', name: 'data_inicio', nullable: false })
    data_inicio: string;

    @Column({ type: 'date', name: 'data_final', nullable: false })
    data_final: string;

    @Column({ type: 'boolean', name: 'turma_aberta', default: false, nullable: false })
    turma_aberta: boolean;

    @Column({ type: 'jsonb', name: 'detalhamento_bonus', nullable: true })
    detalhamento_bonus: { id_treinamento_db: number }[];

    @ManyToOne(() => Polos, (polos) => polos.turmas)
    @JoinColumn([{ name: 'id_polo', referencedColumnName: 'id' }])
    id_polo_fk: Polos;

    @ManyToOne(() => Treinamentos, (treinamentos) => treinamentos.turmas)
    @JoinColumn([{ name: 'id_treinamento', referencedColumnName: 'id' }])
    id_treinamento_fk: Treinamentos;

    @ManyToOne(() => Usuarios, (usuarios) => usuarios.turmas)
    @JoinColumn([{ name: 'lider_evento', referencedColumnName: 'id' }])
    lider_evento_fk: Usuarios;

    @ManyToOne(() => EnderecoEventos)
    @JoinColumn([{ name: 'id_endereco_evento', referencedColumnName: 'id' }])
    id_endereco_evento_fk: EnderecoEventos;

    @OneToMany(() => TurmasAlunos, (turmasAlunos) => turmasAlunos.id_turma_fk)
    turmasAlunos: TurmasAlunos[];

    @OneToMany(() => MasterclassPreCadastros, (masterclassPreCadastros) => masterclassPreCadastros.id_turma_fk)
    masterclassPreCadastros: MasterclassPreCadastros[];
}
