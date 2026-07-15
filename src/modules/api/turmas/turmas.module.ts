import { Module, forwardRef } from '@nestjs/common';
import { TurmasController } from './turmas.controller';
import { TurmasService } from './turmas.service';
import { UnitOfWorkModule } from '../../config/unit_of_work/uow.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { DocumentosModule } from '../documentos/documentos.module';

@Module({
    imports: [UnitOfWorkModule, WhatsAppModule, forwardRef(() => DocumentosModule)],
    controllers: [TurmasController],
    providers: [TurmasService],
    exports: [TurmasService],
})
export class TurmasModule {}
