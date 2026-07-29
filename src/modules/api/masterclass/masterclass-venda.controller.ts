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
     * Busca de pré-cadastros de masterclass (por nome, e-mail ou telefone)
     * para a seleção do aluno na venda com origem em Masterclass. Quando
     * `id_turma` é informado, lista SOMENTE os leads presentes daquela
     * masterclass (termo opcional — vazio retorna os presentes da turma).
     */
    @Get('pre-cadastros/busca')
    async buscarPreCadastrosParaVenda(
        @Query('termo') termo?: string,
        @Query('limit') limit?: string,
        @Query('id_turma') idTurma?: string,
    ): Promise<MasterclassPreCadastroBuscaVendaDto[]> {
        return this.masterclassService.buscarPreCadastrosParaVenda(
            termo || '',
            limit ? parseInt(limit, 10) : undefined,
            idTurma ? parseInt(idTurma, 10) : undefined,
        );
    }
}
