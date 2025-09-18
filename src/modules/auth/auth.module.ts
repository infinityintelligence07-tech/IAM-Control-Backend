import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategy/jwt.strategy';
import { GoogleStrategy } from './strategy/google.strategy';
import { ConfigModule as LocalConfigModule } from '../config/config.module';
import { UnitOfWorkModule } from '../config/unit_of_work/uow.module';
import { MailModule } from '../mail/mail.module';
import { EncryptionService } from '../../common/services/encryption.service';

@Module({
    imports: [
        ConfigModule.forRoot(),
        PassportModule,
        LocalConfigModule,
        UnitOfWorkModule,
        MailModule,
        JwtModule.registerAsync({
            useFactory: () => ({
                secret: process.env.JWT_SECRET,
                signOptions: { expiresIn: '1d' },
            }),
        }),
    ],
    controllers: [AuthController],
    providers: [AuthService, JwtStrategy, GoogleStrategy, EncryptionService],
    exports: [AuthService, EncryptionService],
})
export class AuthModule {}
