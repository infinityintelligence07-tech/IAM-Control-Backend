import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Usuarios } from './usuarios.entity';
import { type_schema } from '../database/typeORM.provider';

@Entity('password_recovery_tokens', { schema: type_schema })
export class PasswordRecoveryTokens {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'int', name: 'id_usuario', nullable: false })
    id_usuario: number;

    @Column({ type: 'uuid', unique: true })
    token: string;

    @ManyToOne(() => Usuarios, (usuarios) => usuarios.passwordRecoveryTokens)
    @JoinColumn([{ name: 'id_usuario', referencedColumnName: 'id' }])
    usuario_fk: Usuarios;

    @CreateDateColumn({ type: 'timestamp', name: 'criado_em', nullable: false })
    criado_em: Date;

    @Column({ type: 'timestamp', name: 'expira_em', nullable: false })
    expira_em: Date;
}
