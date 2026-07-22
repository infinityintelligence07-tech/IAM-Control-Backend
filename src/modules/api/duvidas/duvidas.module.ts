import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { UnitOfWorkModule } from '../../config/unit_of_work/uow.module';
import { DuvidasController } from './duvidas.controller';
import { DuvidasMediaController } from './duvidas-media.controller';
import { DuvidasService } from './duvidas.service';

@Module({
    imports: [UnitOfWorkModule, ConfigModule],
    controllers: [DuvidasController, DuvidasMediaController],
    providers: [DuvidasService],
    exports: [DuvidasService],
})
export class DuvidasModule {}
