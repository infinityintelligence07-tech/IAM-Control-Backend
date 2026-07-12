import { Module } from '@nestjs/common';
import { MasterclassSyncController } from './masterclass-sync.controller';
import { MasterclassSyncService } from './masterclass-sync.service';
import { ConfigModule } from '../../config/config.module';

@Module({
    imports: [ConfigModule],
    controllers: [MasterclassSyncController],
    providers: [MasterclassSyncService],
    exports: [MasterclassSyncService],
})
export class MasterclassSyncModule {}
