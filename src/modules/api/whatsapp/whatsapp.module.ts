import { Module } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { ConfigModule } from '@/modules/config/config.module';
import { ChatGuruModule } from './chatguru/chatguru.module';

@Module({
    imports: [ConfigModule, ChatGuruModule],
    controllers: [WhatsAppController],
    providers: [WhatsAppService],
    exports: [WhatsAppService],
})
export class WhatsAppModule {}
