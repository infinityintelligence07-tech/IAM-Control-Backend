import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, UseInterceptors, ClassSerializerInterceptor, ParseIntPipe, Req } from '@nestjs/common';
import { TurmasService } from './turmas.service';
import {
    GetTurmasDto,
    CreateTurmaDto,
    UpdateTurmaDto,
    AddAlunoTurmaDto,
    UpdateAlunoTurmaDto,
    TransferirAlunoDto,
    TurmasListResponseDto,
    TurmaResponseDto,
    AlunosTurmaListResponseDto,
    AlunosTurmaExportResponseDto,
    AlunoTurmaResponseDto,
    AlunosDisponiveisResponseDto,
    SoftDeleteTurmaDto,
    OpcoesTransferenciaResponseDto,
    HistoricoTransferenciasResponseDto,
    TurmaStatusResumoResponseDto,
    TurmaStatusAlunosResponseDto,
    UpdateTurmaTimesDto,
    TurmaTimesResponseDto,
    UpdateStatusEventoDto,
    TurmaHistoricoResponseDto,
    CreateTurmaHistoricoDto,
    AlunoTurmaHistoricoResponseDto,
    CreateAlunoTurmaHistoricoDto,
    RemoveAlunoTurmaDto,
    UpdateTurmaAcessoraDto,
    LiberarTurmaTemporariamenteDto,
    AlunoHistoricoObservacoesResponseDto,
    GetExtratoMovimentacaoDto,
    ExtratoMovimentacaoResponseDto,
    GetMovimentacaoAlunosDto,
    MovimentacaoAlunosResponseDto,
    GetAlunosSaldoPeriodoDto,
    AlunosSaldoPeriodoResponseDto,
} from './dto/turmas.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { PermissionsGuard } from '@/modules/auth/guards/permissions.guard';
import { RequirePermission } from '@/modules/auth/decorators/require-permission.decorator';
import { HistoricoSorteadoPayload, HistoricoSorteadosFilters, PresenteSorteioPayload, RemoverHistoricoSorteadoPayload } from './turmas.service';

@UseInterceptors(ClassSerializerInterceptor)
@Controller('turmas')
export class TurmasController {
    constructor(private readonly turmasService: TurmasService) {}

    // Rotas específicas (devem vir antes das rotas com parâmetros)

    @Get('presentes-sorteio')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async getPresentesSorteio() {
        return this.turmasService.getPresentesSorteio();
    }

    @Post('presentes-sorteio')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async createPresenteSorteio(@Body() payload: PresenteSorteioPayload, @Req() req: any) {
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        return this.turmasService.createPresenteSorteio(payload, userId);
    }

    @Put('presentes-sorteio/:id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async updatePresenteSorteio(@Param('id', ParseIntPipe) id: number, @Body() payload: PresenteSorteioPayload, @Req() req: any) {
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        return this.turmasService.updatePresenteSorteio(id, payload, userId);
    }

    @Delete('presentes-sorteio/:id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async softDeletePresenteSorteio(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        await this.turmasService.softDeletePresenteSorteio(id, userId);
        return { message: 'Presente removido com sucesso.' };
    }

    @Post('historico-sorteados')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async registrarHistoricoSorteado(@Body() payload: HistoricoSorteadoPayload, @Req() req: any) {
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        return this.turmasService.registrarHistoricoSorteado(payload, userId);
    }

    @Get('historico-sorteados')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async getHistoricoSorteados(@Query() filters: HistoricoSorteadosFilters) {
        return this.turmasService.getHistoricoSorteados(filters);
    }

    @Delete('historico-sorteados/:id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async removerHistoricoSorteado(@Param('id') id: string, @Body() payload: RemoverHistoricoSorteadoPayload, @Req() req: any) {
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        await this.turmasService.removerHistoricoSorteado(id, payload, userId);
        return { message: 'Registro do histórico removido com sucesso.' };
    }

    @Get('usuarios-lideres')
    async getUsuariosLideres(): Promise<{ id: number; nome: string; email: string; cpf: string | null; telefone: string; funcao: string[] }[]> {
        console.log('Buscando usuários líderes');
        try {
            const result = await this.turmasService.getUsuariosLideres();
            console.log('Usuários encontrados:', result);
            return result;
        } catch (error) {
            console.error('Erro no controller ao buscar usuários:', error);
            throw error;
        }
    }

    @Get('alunos-disponiveis')
    async getAlunosDisponiveis(
        @Query('id_turma') id_turma?: number,
        @Query('page') page: number = 1,
        @Query('limit') limit: number = 10,
        @Query('search') search?: string,
    ): Promise<AlunosDisponiveisResponseDto> {
        console.log('Buscando alunos disponíveis para turma:', id_turma, 'search:', search);
        const pageNum = page ? parseInt(page.toString()) : 1;
        const limitNum = limit ? parseInt(limit.toString()) : 10;
        const searchStr = typeof search === 'string' && search.trim() ? search.trim() : undefined;
        return await this.turmasService.getAlunosDisponiveis(id_turma, pageNum, limitNum, searchStr);
    }

    @Get('extrato-movimentacao')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async getExtratoMovimentacao(@Query() filtros: GetExtratoMovimentacaoDto): Promise<ExtratoMovimentacaoResponseDto> {
        return this.turmasService.getExtratoMovimentacaoTurmas(filtros);
    }

    @Get('extrato-movimentacao/:id_turma/alunos')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async getMovimentacaoAlunos(
        @Param('id_turma', ParseIntPipe) id_turma: number,
        @Query() filtros: GetMovimentacaoAlunosDto,
    ): Promise<MovimentacaoAlunosResponseDto> {
        return this.turmasService.getMovimentacaoAlunosTurma(id_turma, filtros);
    }

    @Get('extrato-movimentacao/:id_turma/alunos-saldo')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async getAlunosSaldoPeriodo(
        @Param('id_turma', ParseIntPipe) id_turma: number,
        @Query() filtros: GetAlunosSaldoPeriodoDto,
    ): Promise<AlunosSaldoPeriodoResponseDto> {
        return this.turmasService.getAlunosSaldoPeriodoTurma(id_turma, filtros);
    }

    // Leitura dos bônus do comprador usada pela edição de venda no Histórico de
    // Vendas: liberada a qualquer usuário autenticado (CRUD de vendas sem matriz).
    @Get('bonus-comprador/:id_aluno_comprador')
    @UseGuards(JwtAuthGuard)
    async getBonusMatriculasComprador(@Param('id_aluno_comprador', ParseIntPipe) id_aluno_comprador: number) {
        return this.turmasService.getBonusMatriculasComprador(id_aluno_comprador);
    }

    @Get('aluno/:id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async getAlunoTurmaById(@Param('id') id: string): Promise<AlunoTurmaResponseDto> {
        console.log('Buscando aluno da turma ID:', id);
        try {
            const result = await this.turmasService.getAlunoTurmaByIdDetailed(id);
            console.log('Aluno encontrado:', result);
            return result;
        } catch (error) {
            console.error('Erro no controller ao buscar aluno da turma:', error);
            throw error;
        }
    }

    @Get('alunos/:id_turma_aluno/logs')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async getAlunoTurmaHistorico(@Param('id_turma_aluno') id_turma_aluno: string): Promise<AlunoTurmaHistoricoResponseDto> {
        return this.turmasService.getAlunoTurmaHistorico(id_turma_aluno);
    }

    // Observações da venda (Histórico de Vendas) são gravadas no histórico do
    // aluno por qualquer usuário que esteja vendendo — apenas JWT.
    @Post('alunos/:id_turma_aluno/logs')
    @UseGuards(JwtAuthGuard)
    async createAlunoTurmaHistorico(
        @Param('id_turma_aluno') id_turma_aluno: string,
        @Body() dto: CreateAlunoTurmaHistoricoDto,
        @Req() req: any,
    ): Promise<{ message: string }> {
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        await this.turmasService.createAlunoTurmaHistorico(id_turma_aluno, dto, userId);
        return { message: 'Histórico registrado com sucesso.' };
    }

    /** Histórico (log de alterações) de uma turma/evento. */
    @Get(':id/logs')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async getTurmaHistorico(@Param('id', ParseIntPipe) id: number): Promise<TurmaHistoricoResponseDto> {
        return this.turmasService.getTurmaHistorico(id);
    }

    /** Registra uma observação manual no histórico da turma/evento. */
    @Post(':id/logs')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'edit' })
    async createTurmaHistorico(@Param('id', ParseIntPipe) id: number, @Body() dto: CreateTurmaHistoricoDto, @Req() req: any): Promise<{ message: string }> {
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        await this.turmasService.createTurmaHistorico(id, dto, userId);
        return { message: 'Histórico registrado com sucesso.' };
    }

    @Get('aluno/:id_aluno/historico-observacoes')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async getHistoricoObservacoesAluno(@Param('id_aluno', ParseIntPipe) id_aluno: number): Promise<AlunoHistoricoObservacoesResponseDto> {
        return this.turmasService.getHistoricoObservacoesAluno(id_aluno);
    }

    @Get('opcoes-transferencia/:id_turma_aluno')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async getOpcoesTransferencia(@Param('id_turma_aluno') id_turma_aluno: string): Promise<OpcoesTransferenciaResponseDto> {
        return this.turmasService.getOpcoesTransferencia(id_turma_aluno);
    }

    @Post('transferir-aluno/:id_turma_aluno')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'alunosNaTurma', action: 'edit' })
    async transferirAluno(@Param('id_turma_aluno') id_turma_aluno: string, @Body() dto: TransferirAlunoDto, @Req() req: any): Promise<AlunoTurmaResponseDto> {
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        return this.turmasService.transferirAluno(id_turma_aluno, dto.id_turma_destino, userId);
    }

    @Get('historico-transferencias/:id_aluno')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async getHistoricoTransferencias(@Param('id_aluno', ParseIntPipe) id_aluno: number): Promise<HistoricoTransferenciasResponseDto> {
        return this.turmasService.getHistoricoTransferencias(id_aluno);
    }

    @Get('aluno-trilha/:id_aluno')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async getTrilhaAluno(@Param('id_aluno', ParseIntPipe) id_aluno: number): Promise<
        {
            id_turma_aluno: string;
            status_aluno_turma: string | null;
            presenca_turma: string | null;
            criado_em: Date;
            tipo: 'palestra' | 'treinamento';
            turma: {
                id: number;
                nome_evento: string;
                sigla_evento: string;
                edicao_turma?: string;
                local: string;
                data_inicio: string;
                data_final: string;
                polo?: {
                    nome: string;
                    cidade: string;
                    estado: string;
                };
            };
        }[]
    > {
        console.log('Buscando trilha do aluno ID:', id_aluno);
        return this.turmasService.getTrilhaAluno(id_aluno);
    }

    // CRUD de Turmas

    @Get()
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async findAll(@Query() filters: GetTurmasDto): Promise<TurmasListResponseDto> {
        console.log('Buscando turmas com filtros:', filters);
        return await this.turmasService.findAll(filters);
    }

    @Get('public')
    async findAllPublic(@Query() filters: GetTurmasDto): Promise<TurmasListResponseDto> {
        console.log('🔓 Buscando turmas (endpoint público) com filtros:', filters);
        return await this.turmasService.findAll(filters);
    }

    @Get('ipr-bonus')
    async findIPRTurmasBonus(): Promise<TurmaResponseDto[]> {
        console.log('🎯 Buscando turmas de IPR para bônus...');
        return this.turmasService.findIPRTurmasBonus();
    }

    @Get('public/ipr-bonus')
    async findIPRTurmasBonusPublic(): Promise<TurmaResponseDto[]> {
        console.log('🔓 [DEBUG] Endpoint público /api/turmas/public/ipr-bonus chamado');
        console.log('🔓 [DEBUG] Chamando turmasService.findIPRTurmasBonus()');
        try {
            const result = await this.turmasService.findIPRTurmasBonus();
            console.log('🔓 [DEBUG] Resultado do service:', result.length, 'turmas encontradas');
            return result;
        } catch (error) {
            console.error('🔓 [DEBUG] Erro no controller:', error);
            throw error;
        }
    }

    @Post('snapshot/congelar-lote')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async congelarSnapshotTurmasEmLote(
        @Query('incluir_em_andamento') incluirEmAndamentoParam: string,
        @Query('forcar_regeracao') forcarRegeracaoParam: string,
        @Req() req: any,
    ): Promise<{
        total_turmas: number;
        snapshots_criados: number;
        snapshots_regerados: number;
        snapshots_ja_existentes: number;
        message: string;
    }> {
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        const incluirEmAndamento = ['1', 'true', 'yes', 'on'].includes(
            String(incluirEmAndamentoParam || '')
                .trim()
                .toLowerCase(),
        );
        const forcarRegeracao = ['1', 'true', 'yes', 'on'].includes(
            String(forcarRegeracaoParam || '')
                .trim()
                .toLowerCase(),
        );
        return this.turmasService.congelarSnapshotsTurmasEmLote(userId, {
            incluirEmAndamento,
            forcarRegeracao,
        });
    }

    @Get(':id')
    async findById(@Param('id', ParseIntPipe) id: number): Promise<TurmaResponseDto | null> {
        console.log('Buscando turma por ID:', id);
        return await this.turmasService.findById(id);
    }

    @Get(':id/status-resumo')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async getTurmaStatusResumo(@Param('id', ParseIntPipe) id: number): Promise<TurmaStatusResumoResponseDto> {
        return this.turmasService.getTurmaStatusResumo(id);
    }

    @Get(':id/status-resumo/alunos')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async getTurmaStatusAlunos(@Param('id', ParseIntPipe) id: number, @Query('tipo') tipo: string): Promise<TurmaStatusAlunosResponseDto> {
        return this.turmasService.getTurmaStatusAlunos(id, tipo);
    }

    @Post(':id/snapshot/regerar')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async regerarSnapshotTurma(@Param('id', ParseIntPipe) id: number, @Req() req: any): Promise<{ id_turma: number; snapshot_em: Date; message: string }> {
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        return this.turmasService.regerarSnapshotMetricasTurma(id, userId);
    }

    @Get(':id/times')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'view' })
    async getTimesTurma(@Param('id', ParseIntPipe) id: number): Promise<TurmaTimesResponseDto> {
        return this.turmasService.getTimesTurma(id);
    }

    @Put(':id/times')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'edit' })
    async updateTimesTurma(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateTurmaTimesDto: UpdateTurmaTimesDto,
        @Req() req: any,
    ): Promise<TurmaTimesResponseDto> {
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        return this.turmasService.updateTimesTurma(id, updateTurmaTimesDto, userId);
    }

    @Post()
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'create' })
    async create(@Body() createTurmaDto: CreateTurmaDto): Promise<TurmaResponseDto> {
        console.log('Criando nova turma:', createTurmaDto);
        return this.turmasService.create(createTurmaDto);
    }

    /** Atualiza somente o status do evento no calendário (cores da legenda). */
    @Put(':id/status-evento')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'calendario', action: 'edit' })
    async updateStatusEvento(
        @Param('id', ParseIntPipe) id: number,
        @Body() dto: UpdateStatusEventoDto,
        @Req() req: any,
    ): Promise<{ id: number; status_evento: string }> {
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        return this.turmasService.updateStatusEvento(id, dto.status_evento, userId);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'edit' })
    async update(@Param('id', ParseIntPipe) id: number, @Body() updateTurmaDto: UpdateTurmaDto): Promise<TurmaResponseDto> {
        console.log('Atualizando turma ID:', id, 'com dados:', updateTurmaDto);
        return this.turmasService.update(id, updateTurmaDto);
    }

    @Put(':id/soft-delete')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'delete' })
    async softDelete(@Param('id', ParseIntPipe) id: number, @Body() softDeleteDto: SoftDeleteTurmaDto): Promise<{ message: string }> {
        console.log('Soft delete da turma ID:', id, 'Dados:', softDeleteDto);
        await this.turmasService.softDelete(id, softDeleteDto);
        return { message: 'Turma marcada como deletada com sucesso' };
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'turmas', action: 'delete' })
    async delete(@Param('id', ParseIntPipe) id: number): Promise<{ message: string }> {
        console.log('Deletando turma ID (hard delete):', id);
        await this.turmasService.delete(id);
        return { message: 'Turma deletada permanentemente' };
    }

    // Gerenciamento de Alunos na Turma

    @Get(':id/alunos/export')
    async getAlunosTurmaExport(@Param('id', ParseIntPipe) id_turma: number): Promise<AlunosTurmaExportResponseDto> {
        return this.turmasService.getAlunosTurmaExport(id_turma);
    }

    @Get(':id/alunos')
    async getAlunosTurma(
        @Param('id', ParseIntPipe) id_turma: number,
        @Query('page', ParseIntPipe) page: number = 1,
        @Query('limit', ParseIntPipe) limit: number = 10,
    ): Promise<AlunosTurmaListResponseDto> {
        console.log('Buscando alunos da turma:', id_turma);
        return this.turmasService.getAlunosTurma(id_turma, page, limit);
    }

    /**
     * Libera temporariamente (24h) uma turma já encerrada para venda e credenciamento.
     * Exige observação obrigatória; quem liberou fica registrado no histórico da turma.
     * Mesma permissão de quem opera o credenciamento (marcar presença).
     */
    @Post(':id/liberacao-temporaria')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'credenciamento', action: 'edit' })
    async liberarTurmaTemporariamente(
        @Param('id', ParseIntPipe) id_turma: number,
        @Body() dto: LiberarTurmaTemporariamenteDto,
        @Req() req: any,
    ): Promise<{ id_turma: number; liberada_temporariamente_em: Date; liberada_temporariamente_ate: Date; message: string }> {
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        return this.turmasService.liberarTurmaTemporariamente(id_turma, dto.observacao, userId);
    }

    /** Encerra manualmente (antes das 24h) a liberação temporária: a turma volta a ficar encerrada na hora. */
    @Delete(':id/liberacao-temporaria')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'credenciamento', action: 'edit' })
    async encerrarLiberacaoTemporariaTurma(@Param('id', ParseIntPipe) id_turma: number, @Req() req: any): Promise<{ id_turma: number; message: string }> {
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        return this.turmasService.encerrarLiberacaoTemporariaTurma(id_turma, userId);
    }

    @Put(':id/acessora')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'acessoraTurma', action: 'edit' })
    async updateTurmaAcessora(
        @Param('id', ParseIntPipe) id_turma: number,
        @Body() dto: UpdateTurmaAcessoraDto,
        @Req() req: any,
    ): Promise<{ id_acessora: number | null; acessora: { id: number; nome: string } | null }> {
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        return this.turmasService.updateTurmaAcessora(id_turma, dto?.id_acessora ?? null, userId);
    }

    // ADICIONAR aluno a turma é liberado para QUALQUER usuário autenticado:
    // o fluxo de venda (finalizar venda, inscrições adicionais, bônus e a
    // edição de quantidade no Histórico de Vendas) matricula alunos e qualquer
    // usuário pode atuar como staff/vendedor — sem exigência de permissão.
    @Post(':id/alunos')
    @UseGuards(JwtAuthGuard)
    async addAlunoTurma(@Param('id', ParseIntPipe) id_turma: number, @Body() addAlunoDto: AddAlunoTurmaDto, @Req() req: any): Promise<AlunoTurmaResponseDto> {
        console.log('Adicionando aluno à turma:', id_turma, 'aluno:', addAlunoDto);
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        return this.turmasService.addAlunoTurma(id_turma, addAlunoDto, userId);
    }

    // Atualização da matrícula liberada a qualquer autenticado: a edição de
    // venda no Histórico grava quantidade de inscrições/outros clientes/
    // pendência aqui. As regras de domínio (turma congelada, inadimplente,
    // acessora) continuam validadas no service.
    @Put(':id/alunos/:id_turma_aluno')
    @UseGuards(JwtAuthGuard)
    async updateAlunoTurma(
        @Param('id', ParseIntPipe) id_turma: number,
        @Param('id_turma_aluno') id_turma_aluno: string,
        @Body() updateAlunoDto: UpdateAlunoTurmaDto,
        @Req() req: any,
    ): Promise<AlunoTurmaResponseDto> {
        console.log('Atualizando aluno na turma:', id_turma_aluno, 'com dados:', updateAlunoDto);
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        return this.turmasService.updateAlunoTurma(id_turma_aluno, updateAlunoDto, userId);
    }

    // Remoção de BÔNUS na edição de venda (Histórico de Vendas): liberada a
    // qualquer usuário autenticado — o service garante que só matrículas
    // ALUNO_BONUS podem ser removidas por esta rota (CRUD de vendas sem matriz).
    @Delete(':id/alunos/:id_turma_aluno/bonus-venda')
    @UseGuards(JwtAuthGuard)
    async removeBonusVendaTurmaAluno(
        @Param('id', ParseIntPipe) id_turma: number,
        @Param('id_turma_aluno') id_turma_aluno: string,
        @Req() req: any,
    ): Promise<{ message: string }> {
        console.log('Removendo bônus da venda (Histórico):', id_turma_aluno, 'turma:', id_turma);
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        await this.turmasService.removeBonusVendaTurmaAluno(id_turma_aluno, userId);
        return { message: 'Bônus removido com sucesso' };
    }

    @Delete(':id/alunos/:id_turma_aluno')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'alunosNaTurma', action: 'delete' })
    async removeAlunoTurma(
        @Param('id', ParseIntPipe) id_turma: number,
        @Param('id_turma_aluno') id_turma_aluno: string,
        @Body() dto: RemoveAlunoTurmaDto,
        @Req() req: any,
    ): Promise<{ message: string }> {
        console.log('Removendo aluno da turma:', id_turma_aluno);
        const userId = req?.user?.sub ? Number(req.user.sub) : undefined;
        await this.turmasService.removeAlunoTurma(id_turma_aluno, userId, dto?.motivo);
        return { message: 'Aluno removido da turma com sucesso' };
    }
}
