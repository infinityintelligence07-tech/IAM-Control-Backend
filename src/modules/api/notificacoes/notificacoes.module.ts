import { Module } from '@nestjs/common';

import { NotificacoesController } from './notificacoes.controller';
import { NotificacoesService } from './notificacoes.service';
import { UnitOfWorkModule } from '../../config/unit_of_work/uow.module';

@Module({
    imports: [UnitOfWorkModule],
    controllers: [NotificacoesController],
    providers: [NotificacoesService],
    exports: [NotificacoesService],
})
export class NotificacoesModule {}
