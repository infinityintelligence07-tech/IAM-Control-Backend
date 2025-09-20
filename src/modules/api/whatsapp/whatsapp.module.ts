import { Module } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { ConfigModule } from '@/modules/config/config.module';

@Module({
    imports: [ConfigModule],
    controllers: [WhatsAppController],
    providers: [WhatsAppService],
    exports: [WhatsAppService],
})
export class WhatsAppModule {}
