import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    // Prefixo global para todas as rotas da API
    app.setGlobalPrefix('api');

    // Configuração do body parser para payloads grandes (50MB)
    app.use(bodyParser.json({ limit: '50mb' }));
    app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

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

    const port = process.env.PORT || 3000;
    await app.listen(port);
    const env = process.env.NODE_ENV || 'development';
    console.log(`🚀 Servidor rodando em http://localhost:${port}/api (${env})`);
}
bootstrap();
