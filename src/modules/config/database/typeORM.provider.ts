import * as path from 'node:path';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';
import * as dotenv from 'dotenv';

dotenv.config();

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
        const dataSource = new DataSource({
            name: 'default',
            type: 'postgres',
            host: this.host,
            port: this.port,
            username: this.username,
            password: this.password,
            database: this.database,
            synchronize: true,
            schema: this.schema,
            logging: true,
            migrationsRun: true,
            entities: [path.join(__dirname, '../entities/*.entity{.ts,.js}')],
            migrations: [path.join(__dirname, '../migrations/*{.ts,.js}')],
        });

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

export const ds = new DataSource({
    name: 'default',
    type: 'postgres',
    host: type_host,
    port: type_port,
    username: type_username,
    password: type_password,
    database: type_database,
    synchronize: true,
    schema: type_schema,
    logging: true,
    migrationsRun: true,
    entities: [path.join(__dirname, '../entities/*.entity{.ts,.js}')],
    migrations: [path.join(__dirname, '../migrations/*{.ts,.js}')],
});

ds.initialize();
