import { Module, forwardRef } from '@nestjs/common';
import { TurmasController } from './turmas.controller';
import { TurmasService } from './turmas.service';
import { UnitOfWorkModule } from '../../config/unit_of_work/uow.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { DocumentosModule } from '../documentos/documentos.module';
import { ConfiguracoesModule } from '../configuracoes/configuracoes.module';

@Module({
    imports: [UnitOfWorkModule, WhatsAppModule, ConfiguracoesModule, forwardRef(() => DocumentosModule)],
    controllers: [TurmasController],
    providers: [TurmasService],
    exports: [TurmasService],
})
export class TurmasModule {}
