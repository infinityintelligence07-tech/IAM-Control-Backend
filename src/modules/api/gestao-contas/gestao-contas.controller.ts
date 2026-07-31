import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';

import { WebhookTokenGuard } from '../webhooks/webhook-token.guard';
import { GestaoContasClientesService } from './gestao-contas-clientes.service';
import { GestaoContasStatusService } from './gestao-contas-status.service';
import { ClientesGestaoContasResponseDto, GetClientesGestaoContasDto } from './dto/gestao-contas-clientes.dto';
import { ReceberStatusGestaoContasDto, ReceberStatusGestaoContasResponseDto } from './dto/gestao-contas-status.dto';

/**
 * Integração com a Gestão de Contas (app Lovable `gestaocontasiam`).
 *
 * Autenticação (mesma dos demais webhooks):
 *   - Header `x-webhook-token`
 *   - Header `Authorization: Bearer <token>`
 *   - Query `?token=`
 */
@Controller('webhooks/gestao-contas')
@UseGuards(WebhookTokenGuard)
export class GestaoContasController {
    constructor(
        private readonly clientesService: GestaoContasClientesService,
        private readonly statusService: GestaoContasStatusService,
    ) {}

    /**
     * GET /api/webhooks/gestao-contas/clientes
     *
     * Saída de dados: a Gestão de Contas puxa os clientes do IAM Control com
     * cadastro, matrículas e situação financeira. Use `atualizado_desde` com o
     * `sincronizado_ate` da resposta anterior para sync incremental.
     */
    @Get('clientes')
    async getClientes(@Query() filtros: GetClientesGestaoContasDto): Promise<ClientesGestaoContasResponseDto> {
        return this.clientesService.getClientes(filtros);
    }

    /**
     * POST /api/webhooks/gestao-contas/status
     *
     * Entrada de dados: a Gestão de Contas informa o status de inadimplência dos
     * clientes, que é refletido em `alunos.status_aluno_geral` e na pendência de
     * pagamento das matrículas.
     */
    @Post('status')
    @HttpCode(HttpStatus.OK)
    async receberStatus(@Body() payload: ReceberStatusGestaoContasDto): Promise<{ ok: true } & ReceberStatusGestaoContasResponseDto> {
        const resultado = await this.statusService.receberStatus(payload);
        return { ok: true, ...resultado };
    }
}
