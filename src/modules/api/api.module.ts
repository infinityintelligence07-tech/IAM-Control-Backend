import { Module } from '@nestjs/common';
import { PolosModule } from './polos/polos.module';
import { AlunosModule } from './alunos/alunos.module';
import { TreinamentosModule } from './treinamentos/treinamentos.module';
import { TurmasModule } from './turmas/turmas.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { MasterclassModule } from './masterclass/masterclass.module';
import { DocumentosModule } from './documentos/documentos.module';
import { UsuariosModule } from './usuarios/usuarios.module';

@Module({
    imports: [AlunosModule, PolosModule, TreinamentosModule, TurmasModule, WhatsAppModule, MasterclassModule, DocumentosModule, UsuariosModule],
})
export class ApiModule {}
