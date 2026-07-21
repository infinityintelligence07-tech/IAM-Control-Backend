import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PolosModule } from './polos/polos.module';
import { AlunosModule } from './alunos/alunos.module';
import { TreinamentosModule } from './treinamentos/treinamentos.module';
import { EmpresasModule } from './empresas/empresas.module';
import { TurmasModule } from './turmas/turmas.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { MasterclassModule } from './masterclass/masterclass.module';
import { MasterclassSyncModule } from './masterclass-sync/masterclass-sync.module';
import { DocumentosModule } from './documentos/documentos.module';
import { UsuariosModule } from './usuarios/usuarios.module';
import { EnderecoEventosModule } from './endereco-eventos/endereco-eventos.module';
import { RelatoriosFinanceiroModule } from './relatorios/financeiro/relatorios-financeiro.module';
import { UploadModule } from './upload/upload.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { ConfiguracoesModule } from './configuracoes/configuracoes.module';
import { NotificacoesModule } from './notificacoes/notificacoes.module';
import { VendasModule } from './vendas/vendas.module';
import { DuvidasModule } from './duvidas/duvidas.module';

@Module({
    imports: [
        AuthModule,
        AlunosModule,
        PolosModule,
        TreinamentosModule,
        EmpresasModule,
        TurmasModule,
        WhatsAppModule,
        MasterclassModule,
        MasterclassSyncModule,
        DocumentosModule,
        UsuariosModule,
        EnderecoEventosModule,
        RelatoriosFinanceiroModule,
        UploadModule,
        WebhooksModule,
        ConfiguracoesModule,
        NotificacoesModule,
        VendasModule,
        DuvidasModule,
    ],
})
export class ApiModule {}
