import { Module } from '@nestjs/common';
import { RelatoriosFinanceiroController } from './relatorios-financeiro.controller';
import { RelatoriosFinanceiroService } from './relatorios-financeiro.service';
import { UnitOfWorkModule } from '../../../config/unit_of_work/uow.module';

@Module({
    imports: [UnitOfWorkModule],
    controllers: [RelatoriosFinanceiroController],
    providers: [RelatoriosFinanceiroService],
    exports: [RelatoriosFinanceiroService],
})
export class RelatoriosFinanceiroModule {}
