import * as path from 'node:path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';
import * as dotenv from 'dotenv';

dotenv.config();

const parseNumberEnv = (value: string | undefined, fallback: number): number => {
    if (!value) return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const buildDataSourceOptions = ({
    host,
    port,
    username,
    password,
    database,
    schema,
}: {
    host: string;
    port: number;
    username: string;
    password: string;
    database: string;
    schema: string;
}): DataSourceOptions => ({
    name: 'default',
    type: 'postgres',
    host,
    port,
    username,
    password,
    database,
    synchronize: true,
    schema,
    logging: true,
    migrationsRun: true,
    migrationsTransactionMode: 'each', // cada migration em sua própria transação (evita erro 55P04 com enum no PostgreSQL)
    entities: [path.join(__dirname, '../entities/*.entity{.ts,.js}')],
    subscribers: [path.join(__dirname, '../subscribers/*{.ts,.js}')],
    migrations: [path.join(__dirname, '../migrations/*{.ts,.js}')],
    extra: {
        // Configuração explícita de pool/timeouts para reduzir quedas intermitentes de conexão.
        max: parseNumberEnv(process.env.DB_POOL_MAX, 20),
        min: parseNumberEnv(process.env.DB_POOL_MIN, 2),
        idleTimeoutMillis: parseNumberEnv(process.env.DB_POOL_IDLE_TIMEOUT_MS, 30000),
        connectionTimeoutMillis: parseNumberEnv(process.env.DB_POOL_CONNECTION_TIMEOUT_MS, 10000),
        keepAlive: process.env.DB_POOL_KEEP_ALIVE !== 'false',
    },
});

@Injectable()
export class PostgresSQLProvider {
    private host: string = '';
    private port: number = 0;
    private username: string = '';
    private password: string = '';
    private database: string = '';
    private schema: string = '';
    constructor(private configService: ConfigService) {
        this.host = this.configService.get<string>('DB_HOST') || '';
        this.port = this.configService.get<number>('DB_PORT') || 0;
        this.username = this.configService.get<string>('DB_USERNAME') || '';
        this.password = this.configService.get<string>('DB_PASSWORD') || '';
        this.database = this.configService.get<string>('DB_DATABASE') || '';
        this.schema = this.configService.get<string>('DB_SCHEMA') || '';
    }

    async createDataSource() {
        const dataSource = new DataSource(
            buildDataSourceOptions({
                host: this.host,
                port: this.port,
                username: this.username,
                password: this.password,
                database: this.database,
                schema: this.schema,
            }),
        );

        return dataSource.initialize();
    }
}

let type_host: string = '';
let type_port: number = 0;
let type_username: string = '';
let type_password: string = '';
let type_database: string = '';
export let type_schema: string = '';

type_host = process.env.DB_HOST ? process.env.DB_HOST : '';
type_port = process.env.DB_PORT ? +process.env.DB_PORT : 0;
type_username = process.env.DB_USERNAME ? process.env.DB_USERNAME : '';
type_password = process.env.DB_PASSWORD ? process.env.DB_PASSWORD : '';
type_database = process.env.DB_DATABASE ? process.env.DB_DATABASE : '';
type_schema = process.env.DB_SCHEMA ? process.env.DB_SCHEMA : '';

export const ds = new DataSource(
    buildDataSourceOptions({
        host: type_host,
        port: type_port,
        username: type_username,
        password: type_password,
        database: type_database,
        schema: type_schema,
    }),
);
