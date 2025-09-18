import { Module } from '@nestjs/common';
import { TreinamentosController } from './treinamentos.controller';
import { TreinamentosService } from './treinamentos.service';
import { UnitOfWorkModule } from '../../config/unit_of_work/uow.module';

@Module({
    imports: [UnitOfWorkModule],
    controllers: [TreinamentosController],
    providers: [TreinamentosService],
    exports: [TreinamentosService],
})
export class TreinamentosModule {}
