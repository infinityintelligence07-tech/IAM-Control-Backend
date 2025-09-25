import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { readFileSync } from 'fs';
import { join } from 'path';

async function bootstrap() {
    // Configuração HTTPS
    let httpsOptions = undefined;
    try {
        httpsOptions = {
            key: readFileSync(join(__dirname, '..', 'cert', 'localhost-key.pem')),
            cert: readFileSync(join(__dirname, '..', 'cert', 'localhost.pem')),
        };
        console.log('🔐 HTTPS configurado com certificados locais');
    } catch (error) {
        console.log('⚠️  Certificados HTTPS não encontrados, rodando em HTTP');
    }

    const app = await NestFactory.create(AppModule, { httpsOptions });

    // Configuração do CORS
    app.enableCors({
        origin: process.env.FRONTEND_URL || 'https://localhost:3001',
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
    const protocol = httpsOptions ? 'https' : 'http';
    console.log(`🚀 Servidor rodando em ${protocol}://localhost:${port}`);
}
bootstrap();
