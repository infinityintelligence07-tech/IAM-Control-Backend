import { Module } from '@nestjs/common';
import { ConfiguracoesController } from './configuracoes.controller';
import { ConfiguracoesService } from './configuracoes.service';
import { UnitOfWorkModule } from '../../config/unit_of_work/uow.module';

@Module({
    imports: [UnitOfWorkModule],
    controllers: [ConfiguracoesController],
    providers: [ConfiguracoesService],
    exports: [ConfiguracoesService],
})
export class ConfiguracoesModule {}
