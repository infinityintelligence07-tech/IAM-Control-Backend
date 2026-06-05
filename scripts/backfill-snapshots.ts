import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { Client } from 'pg';
import * as dotenv from 'dotenv';

import { AppModule } from '../src/app.module';
import { TurmasService } from '../src/modules/api/turmas/turmas.service';

dotenv.config();

async function obterAdminId(): Promise<number> {
    const client = new Client({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
    });
    await client.connect();
    try {
        const res = await client.query(
            `SELECT id FROM usuarios
             WHERE deletado_em IS NULL
               AND 'ADMINISTRADOR' = ANY(funcao::text[])
             ORDER BY id ASC
             LIMIT 1`,
        );
        if (!res.rows?.length) {
            throw new Error('Nenhum usuário ADMINISTRADOR encontrado para executar o backfill.');
        }
        return Number(res.rows[0].id);
    } finally {
        await client.end();
    }
}

async function main() {
    const logger = new Logger('backfill-snapshots');
    const adminId = await obterAdminId();
    logger.log(`Usando admin id=${adminId} para gerar snapshots.`);

    const app = await NestFactory.createApplicationContext(AppModule, {
        logger: ['error', 'warn', 'log'],
    });

    try {
        const turmasService = app.get(TurmasService);
        const resultado = await turmasService.congelarSnapshotsTurmasEmLote(adminId, {
            incluirEmAndamento: false,
            forcarRegeracao: false,
        });

        logger.log(`Resultado: ${JSON.stringify(resultado, null, 2)}`);
    } finally {
        await app.close();
    }
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Falha no backfill de snapshots:', err);
        process.exit(1);
    });
