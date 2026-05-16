import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';

@Entity('presentes_sorteio', { schema: type_schema })
export class PresentesSorteio extends BaseEntity {
    @PrimaryGeneratedColumn('increment', {
        type: 'int',
        name: 'id',
        primaryKeyConstraintName: 'pk_presentes_sorteio',
    })
    id: number;

    @Column({ type: 'varchar', name: 'descricao', nullable: false })
    descricao: string;

    @Column({ type: 'text', name: 'imagem_base64', nullable: true })
    imagem_base64?: string | null;

    @Column({ type: 'varchar', name: 'imagem_mime_type', nullable: true })
    imagem_mime_type?: string | null;

    @Column({ type: 'boolean', name: 'para_toda_turma', default: true, nullable: false })
    para_toda_turma: boolean;
}
