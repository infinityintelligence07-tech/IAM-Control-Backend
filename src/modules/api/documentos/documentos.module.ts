import { Module } from '@nestjs/common';
import { DocumentosService } from './documentos.service';
import { DocumentosController } from './documentos.controller';
import { ZapSignService } from './zapsign.service';
import { ContractTemplateService } from './contract-template.service';
import { TermTemplateService } from './term-template.service';
import { PdfBrowserService } from './pdf-browser.service';
import { UnitOfWorkService } from '@/modules/config/unit_of_work/uow.service';
import { UnitOfWorkModule } from '@/modules/config/unit_of_work/uow.module';
import { ConfigModule } from '@nestjs/config';
import { MailModule } from '@/modules/mail/mail.module';
import { TurmasModule } from '../turmas/turmas.module';
import { NotificacoesModule } from '../notificacoes/notificacoes.module';

@Module({
    imports: [UnitOfWorkModule, ConfigModule, MailModule, TurmasModule, NotificacoesModule],
    controllers: [DocumentosController],
    providers: [DocumentosService, ZapSignService, ContractTemplateService, TermTemplateService, PdfBrowserService],
    exports: [DocumentosService, ZapSignService, ContractTemplateService, TermTemplateService, PdfBrowserService],
})
export class DocumentosModule {}
