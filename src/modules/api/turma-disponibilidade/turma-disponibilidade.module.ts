import { Module } from '@nestjs/common';
import { TurmaDisponibilidadeController } from './turma-disponibilidade.controller';
import { TurmaDisponibilidadeService } from './turma-disponibilidade.service';
import { UnitOfWorkModule } from '../../config/unit_of_work/uow.module';

@Module({
    imports: [UnitOfWorkModule],
    controllers: [TurmaDisponibilidadeController],
    providers: [TurmaDisponibilidadeService],
    exports: [TurmaDisponibilidadeService],
})
export class TurmaDisponibilidadeModule {}
