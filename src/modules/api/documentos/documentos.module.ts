import { Module } from '@nestjs/common';
import { DocumentosService } from './documentos.service';
import { DocumentosController } from './documentos.controller';
import { ZapSignService } from './zapsign.service';
import { UnitOfWorkService } from '@/modules/config/unit_of_work/uow.service';
import { UnitOfWorkModule } from '@/modules/config/unit_of_work/uow.module';
import { ConfigModule } from '@nestjs/config';

@Module({
    imports: [UnitOfWorkModule, ConfigModule],
    controllers: [DocumentosController],
    providers: [DocumentosService, ZapSignService],
    exports: [DocumentosService, ZapSignService],
})
export class DocumentosModule {}
