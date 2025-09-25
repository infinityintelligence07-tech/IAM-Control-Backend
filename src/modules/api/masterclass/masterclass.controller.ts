import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Query,
    UploadedFile,
    UseInterceptors,
    ParseIntPipe,
    ClassSerializerInterceptor,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MasterclassService } from './masterclass.service';
import { MasterclassPreCadastros } from '../../config/entities/masterclassPreCadastros.entity';
import {
    CreateMasterclassEventoDto,
    UploadMasterclassCsvDto,
    ConfirmarPresencaDto,
    VincularAlunoDto,
    AlterarInteresseDto,
    MasterclassEventoResponseDto,
    MasterclassListResponseDto,
    MasterclassStatsDto,
    CreateMasterclassPreCadastroDto,
    UpdateMasterclassPreCadastroDto,
    SoftDeleteMasterclassPreCadastroDto,
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
        @Body() body: any,
        @UploadedFile() file: any,
    ): Promise<{ message: string; total_processados: number; duplicados_ignorados: number; erros: string[] }> {
        console.log('Dados recebidos no upload:', {
            body,
            file: file
                ? {
                      filename: file.filename,
                      originalname: file.originalname,
                      mimetype: file.mimetype,
                      size: file.size,
                  }
                : null,
        });

        if (!file) {
            throw new BadRequestException('Arquivo não fornecido');
        }

        // Verificar se todos os campos necessários estão presentes
        if (!body.id_turma) {
            console.error('Campo id_turma não encontrado no body:', body);
            throw new BadRequestException('Campo id_turma é obrigatório');
        }

        // Validar e converter dados do form
        const id_turma = parseInt(body.id_turma);
        if (isNaN(id_turma)) {
            console.error('Valor inválido para id_turma:', body.id_turma);
            throw new BadRequestException('ID da turma deve ser um número válido');
        }

        const observacoes = body.observacoes || undefined;
        const criado_por = body.criado_por ? parseInt(body.criado_por) : undefined;

        console.log('Processando upload para turma:', id_turma, 'criado_por:', criado_por);
        return this.masterclassService.uploadCsv(id_turma, file.buffer, observacoes, file.originalname, criado_por);
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
     * Alterar interesse de um pré-cadastro
     */
    @Put('alterar-interesse')
    async alterarInteresse(@Body() alterarDto: AlterarInteresseDto): Promise<any> {
        console.log('Alterando interesse para pré-cadastro:', alterarDto.id_pre_cadastro, 'teve_interesse:', alterarDto.teve_interesse);
        return this.masterclassService.alterarInteresse(alterarDto);
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
    obterEstatisticas(): {
        total_eventos: number;
        total_inscritos: number;
        total_presentes: number;
        total_ausentes: number;
        taxa_presenca_geral: number;
    } {
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

    /**
     * Inserir novo pré-cadastro manualmente
     */
    @Post('pre-cadastro')
    async inserirPreCadastro(@Body() data: CreateMasterclassPreCadastroDto): Promise<MasterclassPreCadastros> {
        console.log('Inserindo novo pré-cadastro:', data);
        return this.masterclassService.inserirPreCadastro(data);
    }

    /**
     * Editar pré-cadastro existente
     */
    @Put('pre-cadastro/:id')
    async editarPreCadastro(@Param('id') id: string, @Body() data: UpdateMasterclassPreCadastroDto): Promise<MasterclassPreCadastros> {
        console.log('Editando pré-cadastro:', id, data);
        return this.masterclassService.editarPreCadastro(id, data);
    }

    /**
     * Soft delete pré-cadastro
     */
    @Put('pre-cadastro/:id/soft-delete')
    async softDeletePreCadastro(@Param('id') id: string, @Body() softDeleteDto: SoftDeleteMasterclassPreCadastroDto): Promise<{ message: string }> {
        console.log('Soft delete do pré-cadastro:', id, 'Dados:', softDeleteDto);
        await this.masterclassService.softDeletePreCadastro(id, softDeleteDto);
        return { message: 'Pré-cadastro marcado como deletado com sucesso' };
    }

    /**
     * Excluir pré-cadastro
     */
    @Delete('pre-cadastro/:id')
    async excluirPreCadastro(@Param('id') id: string): Promise<{ message: string }> {
        console.log('Excluindo pré-cadastro (hard delete):', id);
        await this.masterclassService.excluirPreCadastro(id);
        return { message: 'Pré-cadastro excluído permanentemente' };
    }
}
