import { Global, Module } from '@nestjs/common';
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
import { AdminGuard } from './guards/admin.guard';
import { AdminOrLiderGuard } from './guards/admin-or-lider.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { PermissionsMatrixService } from './permissions-matrix.service';
import { DuvidasKnowledgeAdminGuard } from './guards/duvidas-knowledge-admin.guard';

@Global()
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
    providers: [
        AuthService,
        JwtStrategy,
        GoogleStrategy,
        EncryptionService,
        AdminGuard,
        AdminOrLiderGuard,
        PermissionsGuard,
        PermissionsMatrixService,
        DuvidasKnowledgeAdminGuard,
    ],
    exports: [
        AuthService,
        EncryptionService,
        PermissionsMatrixService,
        PermissionsGuard,
        AdminGuard,
        AdminOrLiderGuard,
        DuvidasKnowledgeAdminGuard,
    ],
})
export class AuthModule {}
