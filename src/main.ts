import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import * as bodyParser from 'body-parser';
import { AppModule } from './app.module';
import { RequestUserContextInterceptor } from './common/interceptors/request-user-context.interceptor';
import { installStructuredConsoleLogging } from './common/logging/structured-console';

function configureProductionConsolePolicy() {
    const isProduction = process.env.NODE_ENV === 'production';
    const allowVerboseLogs = process.env.ENABLE_DEBUG_LOGS === 'true';

    if (!isProduction || allowVerboseLogs) {
        return;
    }

    const noop = () => undefined;
    console.log = noop;
    console.debug = noop;
    console.info = noop;
}

async function bootstrap() {
    installStructuredConsoleLogging();
    configureProductionConsolePolicy();

    const app = await NestFactory.create<NestExpressApplication>(AppModule);

    // Arquivos estáticos (fotos, imagens da Central de Dúvidas) fora do prefixo /api
    app.useStaticAssets(join(process.cwd(), 'uploads'), {
        prefix: '/uploads',
    });

    // Prefixo global para todas as rotas da API.
    app.setGlobalPrefix('api');

    // Configuração do body parser para payloads grandes (50MB).
    app.use(bodyParser.json({ limit: '100mb' }));
    app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));

    // Configuração do CORS (development: localhost:3001 | production: iamcontrol.com.br)
    const corsOrigins = [
        process.env.FRONTEND_URL,
        'https://www.iamcontrol.com.br',
        'https://iamcontrol.com.br',
        'http://www.iamcontrol.com.br',
        'http://localhost:3001',
    ].filter(Boolean);

    app.enableCors({
        origin: corsOrigins,
        credentials: true,
    });

    // Configuração global de validação
    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    );
    app.useGlobalInterceptors(new RequestUserContextInterceptor());

    const port = process.env.PORT || 3000;
    await app.listen(port);
    const env = process.env.NODE_ENV || 'development';
    console.log(`🚀 Servidor rodando em http://localhost:${port}/api (${env})`);
}
bootstrap();
