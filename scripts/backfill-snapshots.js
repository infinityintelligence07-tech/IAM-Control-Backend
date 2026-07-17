"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const pg_1 = require("pg");
const dotenv = require("dotenv");
const app_module_1 = require("../src/app.module");
const turmas_service_1 = require("../src/modules/api/turmas/turmas.service");
dotenv.config();
async function obterAdminId() {
    const client = new pg_1.Client({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_DATABASE,
    });
    await client.connect();
    try {
        const res = await client.query(`SELECT id FROM usuarios
             WHERE deletado_em IS NULL
               AND 'ADMINISTRADOR' = ANY(funcao::text[])
             ORDER BY id ASC
             LIMIT 1`);
        if (!res.rows?.length) {
            throw new Error('Nenhum usuário ADMINISTRADOR encontrado para executar o backfill.');
        }
        return Number(res.rows[0].id);
    }
    finally {
        await client.end();
    }
}
async function main() {
    const logger = new common_1.Logger('backfill-snapshots');
    const adminId = await obterAdminId();
    logger.log(`Usando admin id=${adminId} para gerar snapshots.`);
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule, {
        logger: ['error', 'warn', 'log'],
    });
    try {
        const turmasService = app.get(turmas_service_1.TurmasService);
        const resultado = await turmasService.congelarSnapshotsTurmasEmLote(adminId, {
            incluirEmAndamento: false,
            forcarRegeracao: false,
        });
        logger.log(`Resultado: ${JSON.stringify(resultado, null, 2)}`);
    }
    finally {
        await app.close();
    }
}
main()
    .then(() => process.exit(0))
    .catch((err) => {
    console.error('Falha no backfill de snapshots:', err);
    process.exit(1);
});
//# sourceMappingURL=backfill-snapshots.js.map