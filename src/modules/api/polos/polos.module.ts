import { Module } from '@nestjs/common';
import { PolosController } from './polos.controller';
import { PolosService } from './polos.service';
import { UnitOfWorkModule } from '../../config/unit_of_work/uow.module';

@Module({
    imports: [UnitOfWorkModule],
    controllers: [PolosController],
    providers: [PolosService],
    exports: [PolosService],
})
export class PolosModule {}
