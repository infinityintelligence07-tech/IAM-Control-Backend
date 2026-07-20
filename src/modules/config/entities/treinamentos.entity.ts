import { Entity, Column, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { Empresas } from './empresas.entity';
import { Turmas } from './turmas.entity';
import { TurmasAlunosTreinamentos } from './turmasAlunosTreinamentos.entity';
import { TurmasAlunosTreinamentosBonus } from './turmasAlunosTreinamentosBonus.entity';

export interface TreinamentoFormaPagamentoAvistaConfig {
    habilitado: boolean;
    valor: number;
}

export interface TreinamentoFormaPagamentoPrazoConfig {
    habilitado: boolean;
    valor: number;
    parcelasMin: number;
    parcelasSemLiberacao: number;
    parcelasMaximasComLiberacao?: number | null;
}

export interface TreinamentoConfiguracaoPagamentos {
    avista: {
        cartaoCredito: TreinamentoFormaPagamentoAvistaConfig;
        cartaoDebito: TreinamentoFormaPagamentoAvistaConfig;
        pixTransferencia: TreinamentoFormaPagamentoAvistaConfig;
        especieDinheiro: TreinamentoFormaPagamentoAvistaConfig;
        link: TreinamentoFormaPagamentoAvistaConfig;
    };
    prazo: {
        cartaoCredito: TreinamentoFormaPagamentoPrazoConfig;
        boleto: TreinamentoFormaPagamentoPrazoConfig;
        link: TreinamentoFormaPagamentoPrazoConfig;
    };
}

@Entity('treinamentos', { schema: type_schema })
export class Treinamentos extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_treinamentos' })
    id: number;

    @Column({ type: 'varchar', name: 'treinamento', nullable: false })
    treinamento: string;

    @Column({ type: 'varchar', name: 'sigla_treinamento', nullable: true })
    sigla_treinamento: string;

    @Column({ type: 'float', name: 'preco_treinamento', nullable: false })
    preco_treinamento: number;

    @Column({ type: 'jsonb', name: 'configuracao_pagamentos', nullable: true })
    configuracao_pagamentos: TreinamentoConfiguracaoPagamentos | null;

    @Column({ type: 'text', name: 'url_logo_treinamento', nullable: true })
    url_logo_treinamento: string;

    @Column({ type: 'boolean', name: 'tipo_treinamento', nullable: false })
    tipo_treinamento: boolean;

    @Column({ type: 'boolean', name: 'tipo_palestra', nullable: false })
    tipo_palestra: boolean;

    @Column({ type: 'boolean', name: 'tipo_mentoria', nullable: false })
    tipo_mentoria: boolean;

    /**
     * Duração da mentoria em meses (ex.: 12 = 1 ano, 6 = Liberty Begin).
     * NULL para treinamentos/palestras (que têm data definida pela turma).
     */
    @Column({ type: 'int', name: 'duracao_meses', nullable: true })
    duracao_meses: number | null;

    @Column({ type: 'boolean', name: 'tipo_online', nullable: false })
    tipo_online: boolean;

    @Column({ type: 'boolean', name: 'tipo_presencial', nullable: false })
    tipo_presencial: boolean;

    /**
     * Empresa dona do treinamento (ex.: IAM ou Liberty). NULL = sem vínculo.
     * Usada para a visualização/filtragem do sistema por empresa; não restringe
     * vendas entre empresas.
     */
    @Column({ type: 'int', name: 'id_empresa', nullable: true })
    id_empresa: number | null;

    @ManyToOne(() => Empresas, (empresa) => empresa.treinamentos, { nullable: true })
    @JoinColumn([{ name: 'id_empresa', referencedColumnName: 'id' }])
    id_empresa_fk: Empresas | null;

    @OneToMany(() => Turmas, (turmas) => turmas.id_polo_fk)
    turmas: Turmas[];

    @OneToMany(() => TurmasAlunosTreinamentos, (turmasAlunosTreinamentos) => turmasAlunosTreinamentos.id_treinamento_fk)
    turmasAlunosTreinamentos: TurmasAlunosTreinamentos[];
}
