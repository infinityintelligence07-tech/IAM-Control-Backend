import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    ParseIntPipe,
    Patch,
    Post,
    Query,
    Req,
    UploadedFile,
    UseGuards,
    UseInterceptors,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Request } from 'express';

import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { AdminGuard } from '@/modules/auth/guards/admin.guard';
import { DuvidasService } from './duvidas.service';
import {
    AprovarSugestaoDto,
    AtualizarArtigoDto,
    CriarArtigoDto,
    DuvidasChatDto,
    ListarArtigosQueryDto,
    ListarSugestoesQueryDto,
} from './dto/duvidas.dto';

@UseGuards(JwtAuthGuard)
@Controller('duvidas')
export class DuvidasController {
    constructor(private readonly duvidasService: DuvidasService) {}

    private userId(req: Request): number {
        return Number((req.user as { sub?: number })?.sub);
    }

    /* ---- Chat ---- */

    @Post('chat')
    async chat(@Body() dto: DuvidasChatDto, @Req() req: Request) {
        return this.duvidasService.chat(dto, this.userId(req));
    }

    @Get('conversas')
    async listarConversas(@Req() req: Request) {
        return this.duvidasService.listarConversas(this.userId(req));
    }

    @Get('conversas/:id')
    async obterConversa(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
        return this.duvidasService.obterConversa(id, this.userId(req));
    }

    @Post('mensagens/:id/sugerir')
    async sugerirDaMensagem(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
        return this.duvidasService.sugerirDaMensagem(id, this.userId(req));
    }

    /* ---- Artigos ---- */

    @Get('artigos')
    async listarArtigos(@Query() query: ListarArtigosQueryDto) {
        return this.duvidasService.listarArtigos({
            q: query.q,
            page: query.page,
            limit: query.limit,
        });
    }

    @Get('artigos/:id')
    async obterArtigo(@Param('id', ParseIntPipe) id: number) {
        return this.duvidasService.obterArtigo(id);
    }

    @UseGuards(AdminGuard)
    @Post('artigos')
    async criarArtigo(@Body() dto: CriarArtigoDto, @Req() req: Request) {
        return this.duvidasService.criarArtigo(dto, this.userId(req));
    }

    @UseGuards(AdminGuard)
    @Patch('artigos/:id')
    async atualizarArtigo(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: AtualizarArtigoDto,
        @Req() req: Request,
    ) {
        return this.duvidasService.atualizarArtigo(id, dto, this.userId(req));
    }

    @UseGuards(AdminGuard)
    @Delete('artigos/:id')
    async arquivarArtigo(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
        return this.duvidasService.arquivarArtigo(id, this.userId(req));
    }

    /* ---- Import ---- */

    @UseGuards(AdminGuard)
    @Post('import/obsidian')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: { fileSize: 80 * 1024 * 1024 },
        }),
    )
    async importarObsidian(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
        if (!file) throw new BadRequestException('Nenhum arquivo enviado');
        return this.duvidasService.importarObsidianZip(file, this.userId(req));
    }

    /* ---- Sugestões ---- */

    @UseGuards(AdminGuard)
    @Get('sugestoes')
    async listarSugestoes(@Query() query: ListarSugestoesQueryDto) {
        return this.duvidasService.listarSugestoes({
            status: query.status,
            page: query.page,
            limit: query.limit,
        });
    }

    @UseGuards(AdminGuard)
    @Post('sugestoes/:id/aprovar')
    async aprovarSugestao(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: AprovarSugestaoDto,
        @Req() req: Request,
    ) {
        return this.duvidasService.aprovarSugestao(id, dto || {}, this.userId(req));
    }

    @UseGuards(AdminGuard)
    @Post('sugestoes/:id/rejeitar')
    async rejeitarSugestao(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
        return this.duvidasService.rejeitarSugestao(id, this.userId(req));
    }
}
