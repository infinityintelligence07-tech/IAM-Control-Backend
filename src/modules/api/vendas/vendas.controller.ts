import { Controller, Get, Query, UseGuards, UseInterceptors, ClassSerializerInterceptor } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { AdminOrLiderGuard } from '@/modules/auth/guards/admin-or-lider.guard';
import { VendasDashboardService } from './vendas-dashboard.service';
import {
    VendasDashboardFiltrosResponseDto,
    VendasDashboardQueryDto,
    VendasDashboardResponseDto,
} from './dto/vendas-dashboard.dto';

/**
 * Dashboard consolidado de vendas.
 *
 * Restrito a administradores e líderes (inclui Líder de Eventos / Masterclass / Confronto).
 * O fluxo de venda e o histórico NÃO passam por este controller.
 */
@UseGuards(JwtAuthGuard, AdminOrLiderGuard)
@UseInterceptors(ClassSerializerInterceptor)
@Controller('vendas')
export class VendasController {
    constructor(private readonly vendasDashboardService: VendasDashboardService) {}

    @Get('dashboard')
    async getDashboard(@Query() query: VendasDashboardQueryDto): Promise<VendasDashboardResponseDto> {
        return this.vendasDashboardService.getDashboard(query);
    }

    @Get('dashboard/filtros')
    async getFiltros(): Promise<VendasDashboardFiltrosResponseDto> {
        return this.vendasDashboardService.getFiltros();
    }
}
