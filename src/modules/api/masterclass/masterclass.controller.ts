import { Controller, Get, Post, Put, Body, Param, Query, UploadedFile, UseInterceptors, ParseIntPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MasterclassService } from './masterclass.service';
import {
    CreateMasterclassEventoDto,
    UploadMasterclassCsvDto,
    ConfirmarPresencaDto,
    VincularAlunoDto,
    MasterclassEventoResponseDto,
    MasterclassListResponseDto,
    MasterclassStatsDto,
} from './dto/masterclass.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { UseGuards } from '@nestjs/common';

@UseInterceptors(ClassSerializerInterceptor)
@Controller('masterclass')
@UseGuards(JwtAuthGuard)
export class MasterclassController {
    constructor(private readonly masterclassService: MasterclassService) {}

    /**
     * Criar um novo evento de masterclass
     */
    @Post('eventos')
    async createEvento(@Body() createEventoDto: CreateMasterclassEventoDto): Promise<MasterclassEventoResponseDto> {
        console.log('Criando evento de masterclass:', createEventoDto);
        return this.masterclassService.createEvento(createEventoDto);
    }

    /**
     * Upload de arquivo CSV para importar pré-cadastros
     */
    @Post('upload-csv')
    @UseInterceptors(FileInterceptor('file'))
    async uploadCsv(
        @Body() uploadDto: UploadMasterclassCsvDto,
        @UploadedFile() file: any,
    ): Promise<{ message: string; total_processados: number; erros: string[] }> {
        console.log('Upload CSV para turma:', uploadDto.id_turma);

        if (!file) {
            throw new Error('Arquivo não fornecido');
        }

        return this.masterclassService.uploadCsv(uploadDto.id_turma, file.buffer, uploadDto.observacoes);
    }

    /**
     * Listar todos os eventos de masterclass
     */
    @Get('eventos')
    async listarEventos(@Query('page', ParseIntPipe) page: number = 1, @Query('limit', ParseIntPipe) limit: number = 10): Promise<MasterclassListResponseDto> {
        console.log('Listando eventos de masterclass - página:', page, 'limite:', limit);
        return this.masterclassService.listarEventos(page, limit);
    }

    /**
     * Buscar detalhes de um evento específico
     */
    @Get('eventos/:id_turma')
    async buscarEvento(@Param('id_turma', ParseIntPipe) id_turma: number): Promise<MasterclassEventoResponseDto> {
        console.log('Buscando evento para turma:', id_turma);
        return this.masterclassService.buscarEvento(id_turma);
    }

    /**
     * Confirmar presença de um pré-cadastro
     */
    @Put('confirmar-presenca')
    async confirmarPresenca(@Body() confirmarDto: ConfirmarPresencaDto): Promise<any> {
        console.log('Confirmando presença para pré-cadastro:', confirmarDto.id_pre_cadastro);
        return this.masterclassService.confirmarPresenca(confirmarDto);
    }

    /**
     * Vincular pré-cadastro a um aluno existente
     */
    @Put('vincular-aluno')
    async vincularAluno(@Body() vincularDto: VincularAlunoDto): Promise<any> {
        console.log('Vinculando aluno:', vincularDto.id_aluno, 'ao pré-cadastro:', vincularDto.id_pre_cadastro);
        return this.masterclassService.vincularAluno(vincularDto);
    }

    /**
     * Buscar alunos ausentes para campanhas de marketing
     */
    @Get('alunos-ausentes-marketing')
    async buscarAlunosAusentesParaMarketing(@Query('evento_nome') evento_nome?: string): Promise<MasterclassStatsDto[]> {
        console.log('Buscando alunos ausentes para marketing. Evento:', evento_nome || 'todos');
        return this.masterclassService.buscarAlunosAusentesParaMarketing(evento_nome);
    }

    /**
     * Estatísticas gerais de masterclass
     */
    @Get('estatisticas')
    async obterEstatisticas(): Promise<{
        total_eventos: number;
        total_inscritos: number;
        total_presentes: number;
        total_ausentes: number;
        taxa_presenca_geral: number;
    }> {
        console.log('Obtendo estatísticas gerais de masterclass');

        // Implementar lógica de estatísticas gerais
        // Por enquanto, retornar dados mockados

        return {
            total_eventos: 0,
            total_inscritos: 0,
            total_presentes: 0,
            total_ausentes: 0,
            taxa_presenca_geral: 0,
        };
    }
}
