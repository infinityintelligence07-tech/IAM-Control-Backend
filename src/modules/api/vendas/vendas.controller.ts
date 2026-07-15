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
 * O frontend deve consumir estas rotas em vez de paginar contratos-banco
 * + N chamadas de status-resumo por turma.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission({ module: 'vendas', action: 'view' })
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
