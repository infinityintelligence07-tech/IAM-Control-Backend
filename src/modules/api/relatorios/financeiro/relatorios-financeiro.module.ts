import { Module } from '@nestjs/common';
import { RelatoriosFinanceiroController } from './relatorios-financeiro.controller';
import { RelatoriosFinanceiroService } from './relatorios-financeiro.service';
import { UnitOfWorkModule } from '../../../config/unit_of_work/uow.module';
import { AdminOrLiderGuard } from '../../../auth/guards/admin-or-lider.guard';

@Module({
    imports: [UnitOfWorkModule],
    controllers: [RelatoriosFinanceiroController],
    providers: [RelatoriosFinanceiroService, AdminOrLiderGuard],
    exports: [RelatoriosFinanceiroService],
})
export class RelatoriosFinanceiroModule {}

