import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { ApiModule } from './api/api.module';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';

@Module({
    imports: [ApiModule, AuthModule, ConfigModule, MailModule],
})
export class ModulesModule {}
