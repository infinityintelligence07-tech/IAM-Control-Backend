import { Module } from '@nestjs/common';
import { TurmasController } from './turmas.controller';
import { TurmasService } from './turmas.service';
import { UnitOfWorkModule } from '../../config/unit_of_work/uow.module';

@Module({
    imports: [UnitOfWorkModule],
    controllers: [TurmasController],
    providers: [TurmasService],
    exports: [TurmasService],
})
export class TurmasModule {}
