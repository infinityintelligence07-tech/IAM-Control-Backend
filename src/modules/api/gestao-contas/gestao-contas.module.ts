import { Module } from '@nestjs/common';

import { ConfigModule } from '../../config/config.module';
import { GestaoContasTokenGuard } from './gestao-contas-token.guard';
import { GestaoContasController } from './gestao-contas.controller';
import { GestaoContasClientesService } from './gestao-contas-clientes.service';
import { GestaoContasStatusService } from './gestao-contas-status.service';

@Module({
    imports: [ConfigModule],
    controllers: [GestaoContasController],
    providers: [GestaoContasClientesService, GestaoContasStatusService, GestaoContasTokenGuard],
    exports: [GestaoContasClientesService, GestaoContasStatusService],
})
export class GestaoContasModule {}
