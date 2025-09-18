import { Module } from '@nestjs/common';
import { TypeORMModule } from './database/typeORM.module';
import { UnitOfWorkModule } from './unit_of_work/uow.module';

@Module({
    imports: [TypeORMModule, UnitOfWorkModule],
})
export class ConfigModule {}
