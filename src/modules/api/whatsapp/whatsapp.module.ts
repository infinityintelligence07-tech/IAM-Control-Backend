import { Module } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppBulkQueueService } from './whatsapp-bulk-queue.service';
import { ConfigModule } from '@/modules/config/config.module';
import { ChatGuruModule } from './chatguru/chatguru.module';

@Module({
    imports: [ConfigModule, ChatGuruModule],
    controllers: [WhatsAppController],
    providers: [WhatsAppService, WhatsAppBulkQueueService],
    exports: [WhatsAppService],
})
export class WhatsAppModule {}
