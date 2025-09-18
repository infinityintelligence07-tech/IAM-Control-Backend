import { Module } from '@nestjs/common';
import { PostgresSQLProvider } from './typeORM.provider';
import { ConfigModule } from '@nestjs/config';

@Module({
    imports: [ConfigModule],
    providers: [
        PostgresSQLProvider,
        {
            provide: 'POSTGRES_DB',
            useFactory: async (postgresSQLProvider: PostgresSQLProvider) => {
                return postgresSQLProvider.createDataSource();
            },
            inject: [PostgresSQLProvider],
        },
    ],
    exports: ['POSTGRES_DB'],
})
export class TypeORMModule {}
