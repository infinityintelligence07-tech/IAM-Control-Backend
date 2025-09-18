import { CreateDateColumn, UpdateDateColumn, DeleteDateColumn, BeforeInsert, BeforeUpdate, Column } from 'typeorm';

export class BaseEntity {
    /*======================================================================================*/
    @CreateDateColumn({ type: 'timestamp', name: 'criado_em', nullable: false })
    criado_em: Date;

    @UpdateDateColumn({ type: 'timestamp', name: 'atualizado_em', nullable: false })
    atualizado_em: Date;

    @DeleteDateColumn({ type: 'timestamp', name: 'deletado_em', nullable: true })
    deletado_em?: Date;

    @BeforeInsert()
    updateTimestamps() {
        this.criado_em = new Date();
        this.atualizado_em = new Date();
    }

    @BeforeUpdate()
    updateUpdatedAt() {
        this.atualizado_em = new Date();
    }
    /*======================================================================================*/
    @Column({ type: 'int', name: 'criado_por', nullable: true })
    criado_por: number;

    @Column({ type: 'int', name: 'atualizado_por', nullable: true })
    atualizado_por: number;
    /*======================================================================================*/
}
