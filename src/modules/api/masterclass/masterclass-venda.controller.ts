import { ClassSerializerInterceptor, Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { MasterclassService } from './masterclass.service';
import { MasterclassPreCadastroBuscaVendaDto } from './dto/masterclass.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';

/**
 * Endpoints de masterclass usados pelo FLUXO DE VENDA. Seguem a regra geral do
 * módulo de vendas: liberados a QUALQUER usuário autenticado (somente
 * JwtAuthGuard, sem PermissionsGuard/matriz), diferentemente do
 * MasterclassController, que exige permissão de credenciamento.
 */
@UseInterceptors(ClassSerializerInterceptor)
@Controller('masterclass')
@UseGuards(JwtAuthGuard)
export class MasterclassVendaController {
    constructor(private readonly masterclassService: MasterclassService) {}

    /**
     * Busca em TODOS os pré-cadastros de masterclass (por nome, e-mail ou
     * telefone) para a seleção do aluno na venda com origem em Masterclass.
     */
    @Get('pre-cadastros/busca')
    async buscarPreCadastrosParaVenda(
        @Query('termo') termo?: string,
        @Query('limit') limit?: string,
    ): Promise<MasterclassPreCadastroBuscaVendaDto[]> {
        return this.masterclassService.buscarPreCadastrosParaVenda(termo || '', limit ? parseInt(limit, 10) : undefined);
    }
}
