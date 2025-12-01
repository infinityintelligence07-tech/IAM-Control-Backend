import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { Polos } from './polos.entity';

@Entity('endereco_eventos', { schema: type_schema })
export class EnderecoEventos extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'int', name: 'id', primaryKeyConstraintName: 'pk_endereco_eventos' })
    id: number;

    @Column({ type: 'int', name: 'id_polo', nullable: false })
    id_polo: number;

    @Column({ type: 'varchar', name: 'local_evento', nullable: true })
    local_evento: string;

    @Column({ type: 'varchar', name: 'logradouro', nullable: true })
    logradouro: string;

    @Column({ type: 'varchar', name: 'numero', nullable: true })
    numero: string;

    @Column({ type: 'varchar', name: 'bairro', nullable: true })
    bairro: string;

    @Column({ type: 'varchar', name: 'cidade', nullable: true })
    cidade: string;

    @Column({ type: 'varchar', name: 'estado', nullable: true })
    estado: string;

    @Column({ type: 'varchar', name: 'cep', nullable: true })
    cep: string;

    @ManyToOne(() => Polos)
    @JoinColumn([{ name: 'id_polo', referencedColumnName: 'id' }])
    id_polo_fk: Polos;
}
