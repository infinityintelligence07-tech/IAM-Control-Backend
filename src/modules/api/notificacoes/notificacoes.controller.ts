import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';

import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { NotificacoesService } from './notificacoes.service';
import { MarcarNotificacoesLidasDto, NotificacoesListResponseDto } from './dto/notificacoes.dto';

@UseGuards(JwtAuthGuard)
@Controller('notificacoes')
export class NotificacoesController {
    constructor(private readonly notificacoesService: NotificacoesService) {}

    @Get()
    async listar(@Req() req: Request): Promise<NotificacoesListResponseDto> {
        const userId = Number((req.user as any)?.sub);
        if (!Number.isInteger(userId)) {
            return { data: [], total: 0, nao_lidas: 0 };
        }
        return this.notificacoesService.listarNotificacoesDoUsuario(userId);
    }

    @Post('marcar-lidas')
    async marcarLidas(@Body() dto: MarcarNotificacoesLidasDto, @Req() req: Request): Promise<{ marcadas: number }> {
        const userId = Number((req.user as any)?.sub);
        if (!Number.isInteger(userId)) {
            return { marcadas: 0 };
        }
        return this.notificacoesService.marcarComoLidas(userId, dto?.ids);
    }
}
