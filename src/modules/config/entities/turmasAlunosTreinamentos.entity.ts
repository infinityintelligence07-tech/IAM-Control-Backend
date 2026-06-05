import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';

import { BaseEntity } from './baseEntity.entity';
import { type_schema } from '../database/typeORM.provider';
import { TurmasAlunos } from './turmasAlunos.entity';
import { Treinamentos } from './treinamentos.entity';
import { Turmas } from './turmas.entity';
import { EFormasPagamento } from './enum';
import { TurmasAlunosTreinamentosContratos } from './turmasAlunosTreinamentosContratos.entity';

@Entity('turmas_alunos_treinamentos', { schema: type_schema })
export class TurmasAlunosTreinamentos extends BaseEntity {
    @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'id', primaryKeyConstraintName: 'pk_turmas_alunos_trn' })
    id: string;

    @Column({ type: 'bigint', name: 'id_turma_aluno', nullable: false })
    id_turma_aluno: string;

    @Column({ type: 'int', name: 'id_treinamento', nullable: false })
    id_treinamento: number;

    /**
     * Turma DESTINO do treinamento contratado (ex.: turma 87 = Confronto 54).
     * Adicionado pela migration 1773700000000-AddIdTurmaDestinoVendas.
     */
    @Column({ type: 'bigint', name: 'id_turma_destino', nullable: true })
    id_turma_destino: string | null;

    /**
     * Início do período da mentoria para este mentorado (data da assinatura/finalização
     * do contrato). NULL quando o treinamento contratado não é uma mentoria.
     */
    @Column({ type: 'date', name: 'data_inicio_mentoria', nullable: true })
    data_inicio_mentoria: string | null;

    /**
     * Fim do período da mentoria (início + duração configurada no cadastro).
     */
    @Column({ type: 'date', name: 'data_fim_mentoria', nullable: true })
    data_fim_mentoria: string | null;

    @Column({ type: 'float', name: 'preco_treinamento', nullable: false })
    preco_treinamento: number;

    @Column({ type: 'jsonb', name: 'forma_pgto', nullable: false })
    forma_pgto: { forma: EFormasPagamento; valor: number }[];

    @Column({ type: 'float', name: 'preco_total_pago', nullable: false })
    preco_total_pago: number;

    @ManyToOne(() => TurmasAlunos, (turmasAlunos) => turmasAlunos.turmasAlunosTreinamentos)
    @JoinColumn([{ name: 'id_turma_aluno', referencedColumnName: 'id' }])
    id_turma_aluno_fk: TurmasAlunos;

    @ManyToOne(() => Treinamentos, (treinamentos) => treinamentos.turmasAlunosTreinamentos)
    @JoinColumn([{ name: 'id_treinamento', referencedColumnName: 'id' }])
    id_treinamento_fk: Treinamentos;

    @ManyToOne(() => Turmas, (turmas) => turmas.turmasAlunosTreinamentosDestino, { nullable: true })
    @JoinColumn([{ name: 'id_turma_destino', referencedColumnName: 'id' }])
    id_turma_destino_fk: Turmas | null;

    @OneToMany(() => TurmasAlunosTreinamentosContratos, (turmasAlunosTreinamentosContratos) => turmasAlunosTreinamentosContratos.id_turma_aluno_treinamento_fk)
    turmasAlunosTreinamentosContratos: TurmasAlunosTreinamentosContratos[];
}
