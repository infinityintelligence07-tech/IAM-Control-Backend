import { Module } from '@nestjs/common';
import { UnitOfWorkModule } from '@/modules/config/unit_of_work/uow.module';
import { VendasController } from './vendas.controller';
import { VendasDashboardService } from './vendas-dashboard.service';

@Module({
    imports: [UnitOfWorkModule],
    controllers: [VendasController],
    providers: [VendasDashboardService],
    exports: [VendasDashboardService],
})
export class VendasModule {}
