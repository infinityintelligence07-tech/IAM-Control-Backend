import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ChatGuruService } from './chatguru.service';

@Module({
    imports: [HttpModule],
    providers: [ChatGuruService],
    exports: [ChatGuruService],
})
export class ChatGuruModule {}

