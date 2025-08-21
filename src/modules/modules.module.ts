import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { ApiModule } from './api/api.module';
import { GuardModule } from './guard/guard.module';
import { MailModule } from './mail/mail.module';

@Module({
    imports: [ApiModule, ConfigModule, GuardModule, MailModule],
})
export class ModulesModule {}
