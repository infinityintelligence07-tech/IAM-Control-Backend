import { Module } from '@nestjs/common';
import { MasterclassSyncController } from './masterclass-sync.controller';
import { MasterclassSyncService } from './masterclass-sync.service';
import { MasterclassPushController } from './masterclass-push.controller';
import { MasterclassPushService } from './masterclass-push.service';
import { ConfigModule } from '../../config/config.module';
import { WebhookTokenGuard } from '../webhooks/webhook-token.guard';

@Module({
    imports: [ConfigModule],
    controllers: [MasterclassSyncController, MasterclassPushController],
    providers: [MasterclassSyncService, MasterclassPushService, WebhookTokenGuard],
    exports: [MasterclassSyncService, MasterclassPushService],
})
export class MasterclassSyncModule {}
