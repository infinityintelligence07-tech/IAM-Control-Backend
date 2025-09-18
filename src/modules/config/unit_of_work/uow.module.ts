import { Module } from '@nestjs/common';
import { UnitOfWorkService } from './uow.service';
import { TypeORMModule } from '@/modules/config/database/typeORM.module';

@Module({
    imports: [TypeORMModule],
    providers: [UnitOfWorkService],
    exports: [UnitOfWorkService],
})
export class UnitOfWorkModule {}
