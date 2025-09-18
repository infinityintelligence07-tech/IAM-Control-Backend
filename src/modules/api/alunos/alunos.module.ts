import { Module } from '@nestjs/common';
import { AlunosController } from './alunos.controller';
import { AlunosService } from './alunos.service';
import { UnitOfWorkModule } from '../../config/unit_of_work/uow.module';

@Module({
    imports: [UnitOfWorkModule],
    controllers: [AlunosController],
    providers: [AlunosService],
    exports: [AlunosService],
})
export class AlunosModule {}
