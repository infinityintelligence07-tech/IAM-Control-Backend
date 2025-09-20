import { Module } from '@nestjs/common';
import { MasterclassController } from './masterclass.controller';
import { MasterclassService } from './masterclass.service';
import { ConfigModule } from '../../config/config.module';

@Module({
    imports: [ConfigModule],
    controllers: [MasterclassController],
    providers: [MasterclassService],
    exports: [MasterclassService],
})
export class MasterclassModule {}
