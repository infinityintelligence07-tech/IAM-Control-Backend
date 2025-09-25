import { Module } from '@nestjs/common';
import { DocumentosService } from './documentos.service';
import { DocumentosController } from './documentos.controller';
import { UnitOfWorkService } from '@/modules/config/unit_of_work/uow.service';
import { UnitOfWorkModule } from '@/modules/config/unit_of_work/uow.module';

@Module({
    imports: [UnitOfWorkModule],
    controllers: [DocumentosController],
    providers: [DocumentosService],
    exports: [DocumentosService],
})
export class DocumentosModule {}
