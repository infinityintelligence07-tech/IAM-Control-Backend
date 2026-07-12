import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, OneToMany, Index } from 'typeorm';

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
import { TurmasAlunosTreinamentos } from './turmasAlunosTreinamentos.entity';

export interface TimeEquipeGrupo {
    id: string;
    nome: string;
    liderId: string;
    membrosIds: string[];
}

@Entity('turmas', { schema: type_schema })
export class Turmas extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_turmas' })
    id: number;

    @Column({ type: 'int', name: 'id_polo', nullable: false })
    id_polo: number;

    // Identificador do evento na origem externa (ex.: feed de masterclass do
    // dash-masterclass-iam). Usado para sincronização idempotente: cada masterclass
    // importada guarda aqui o UUID de origem para evitar duplicidade em novas execuções.
    // NULL para turmas criadas manualmente dentro do IAM Control.
    @Index('idx_turmas_referencia_externa')
    @Column({ type: 'varchar', name: 'referencia_externa', nullable: true })
    referencia_externa: string | null;

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

    // Mentorias não têm capacidade de sala definida.
    @Column({ type: 'int', name: 'capacidade_turma', nullable: true })
    capacidade_turma: number | null;

    @Column({ type: 'int', name: 'meta', nullable: true })
    meta: number;

    // Pico (máximo histórico) de inscritos. A meta é congelada sobre este valor:
    // transferências/remoções não reduzem a meta, mas novos picos a elevam.
    @Column({ type: 'int', name: 'meta_pico_inscritos', nullable: true })
    meta_pico_inscritos: number | null;

    // Pico (máximo histórico) de alunos extras (bônus + transferência + transbordo + sorteio).
    @Column({ type: 'int', name: 'meta_pico_extras', nullable: true })
    meta_pico_extras: number | null;

    // Mentorias não têm data de evento (o período é por mentorado, a partir da assinatura).
    @Column({ type: 'date', name: 'data_inicio', nullable: true })
    data_inicio: string | null;

    @Column({ type: 'date', name: 'data_final', nullable: true })
    data_final: string | null;

    @Column({ type: 'boolean', name: 'turma_aberta', default: false, nullable: false })
    turma_aberta: boolean;

    // Quando true, a turma foi REABERTA manualmente após o fim do evento (status != ENCERRADA com
    // data_final já passada). Os processos automáticos NÃO devem reencerrá-la nem regerar snapshot;
    // ela só volta a congelar quando for marcada como ENCERRADA novamente (e estiver após D+1).
    @Column({ type: 'boolean', name: 'reaberta_manualmente', default: false, nullable: false })
    reaberta_manualmente: boolean;

    @Column({ type: 'jsonb', name: 'detalhamento_bonus', nullable: true })
    detalhamento_bonus: { id_treinamento_db: number }[];

    @Column({ type: 'jsonb', name: 'turmas_imersao_ofertadas', nullable: true })
    turmas_imersao_ofertadas: number[];

    @Column({ type: 'jsonb', name: 'turmas_ipr_relacionadas', nullable: true })
    turmas_ipr_relacionadas: number[];

    @Column({ type: 'jsonb', name: 'times_equipes', nullable: true })
    times_equipes: TimeEquipeGrupo[];

    @Column({ type: 'varchar', name: 'url_midia_kit', nullable: true })
    url_midia_kit: string;

    @Column({ type: 'varchar', name: 'url_grupo_whatsapp', nullable: true })
    url_grupo_whatsapp: string;

    @Column({ type: 'varchar', name: 'url_grupo_whatsapp_2', nullable: true })
    url_grupo_whatsapp_2: string;

    @Column({ type: 'varchar', name: 'url_pagamento_cartao', nullable: true })
    url_pagamento_cartao: string;

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

    @OneToMany(() => TurmasAlunosTreinamentos, (tat) => tat.id_turma_destino_fk)
    turmasAlunosTreinamentosDestino: TurmasAlunosTreinamentos[];

    @OneToMany(() => TurmasAlunosTreinamentosBonus, (bonus) => bonus.id_turma_bonus_fk)
    turmasAlunosTreinamentosBonus: TurmasAlunosTreinamentosBonus[];

    @OneToMany(() => MasterclassPreCadastros, (mpc) => mpc.id_turma_fk)
    masterclassPreCadastros: MasterclassPreCadastros[];
}
