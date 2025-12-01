import { Module } from '@nestjs/common';
import { EnderecoEventosController } from './endereco-eventos.controller';
import { EnderecoEventosService } from './endereco-eventos.service';
import { UnitOfWorkModule } from '../../config/unit_of_work/uow.module';

@Module({
    imports: [UnitOfWorkModule],
    controllers: [EnderecoEventosController],
    providers: [EnderecoEventosService],
    exports: [EnderecoEventosService],
})
export class EnderecoEventosModule {}

