import { Controller, Get, Query, UseGuards, UseInterceptors, ClassSerializerInterceptor } from '@nestjs/common';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { PermissionsGuard } from '@/modules/auth/guards/permissions.guard';
import { RequirePermission } from '@/modules/auth/decorators/require-permission.decorator';
import { VendasDashboardService } from './vendas-dashboard.service';
import {
    VendasDashboardFiltrosResponseDto,
    VendasDashboardQueryDto,
    VendasDashboardResponseDto,
} from './dto/vendas-dashboard.dto';

/**
 * Dashboard consolidado de vendas.
 *
 * Exige vendasDashboard.view (padrão: Líder de Eventos e acima, prioridade ≥ 80).
 * O fluxo de venda e o histórico NÃO passam por este controller.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission({ module: 'vendasDashboard', action: 'view' })
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
