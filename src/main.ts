import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    // Configuração do body parser para payloads grandes (50MB)
    app.use(bodyParser.json({ limit: '50mb' }));
    app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

    // Configuração do CORS
    app.enableCors({
        origin: [
            process.env.FRONTEND_URL || 'http://iamcontrol.com.br',
            'https://www.iamcontrol.com.br',
            'https://iamcontrol.com.br',
            'http://www.iamcontrol.com.br',
        ],
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
    console.log(`🚀 Servidor rodando em http://localhost:${port}`);
}
bootstrap();
