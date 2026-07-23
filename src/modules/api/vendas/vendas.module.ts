import { Module } from '@nestjs/common';
import { UnitOfWorkModule } from '@/modules/config/unit_of_work/uow.module';
import { ConfiguracoesModule } from '@/modules/api/configuracoes/configuracoes.module';
import { VendasController } from './vendas.controller';
import { VendasDashboardService } from './vendas-dashboard.service';

@Module({
    imports: [UnitOfWorkModule, ConfiguracoesModule],
    controllers: [VendasController],
    providers: [VendasDashboardService],
    exports: [VendasDashboardService],
})
export class VendasModule {}
