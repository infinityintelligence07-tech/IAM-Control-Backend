import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, UseInterceptors, ClassSerializerInterceptor, ParseIntPipe } from '@nestjs/common';
import { TurmasService } from './turmas.service';
import {
    GetTurmasDto,
    CreateTurmaDto,
    UpdateTurmaDto,
    AddAlunoTurmaDto,
    UpdateAlunoTurmaDto,
    TurmasListResponseDto,
    TurmaResponseDto,
    AlunosTurmaListResponseDto,
    AlunoTurmaResponseDto,
    AlunosDisponiveisResponseDto,
} from './dto/turmas.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';

@UseInterceptors(ClassSerializerInterceptor)
@Controller('turmas')
export class TurmasController {
    constructor(private readonly turmasService: TurmasService) {}

    // Rotas específicas (devem vir antes das rotas com parâmetros)

    @Get('usuarios-lideres')
    async getUsuariosLideres(): Promise<{ id: number; nome: string; email: string; funcao: string }[]> {
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
    ): Promise<AlunosDisponiveisResponseDto> {
        console.log('Buscando alunos disponíveis para turma:', id_turma);
        const pageNum = page ? parseInt(page.toString()) : 1;
        const limitNum = limit ? parseInt(limit.toString()) : 10;
        return this.turmasService.getAlunosDisponiveis(id_turma, pageNum, limitNum);
    }

    // CRUD de Turmas

    @Get()
    @UseGuards(JwtAuthGuard)
    async findAll(@Query() filters: GetTurmasDto): Promise<TurmasListResponseDto> {
        console.log('Buscando turmas com filtros:', filters);
        return this.turmasService.findAll(filters);
    }

    @Get(':id')
    async findById(@Param('id', ParseIntPipe) id: number): Promise<TurmaResponseDto | null> {
        console.log('Buscando turma por ID:', id);
        return this.turmasService.findById(id);
    }

    @Post()
    @UseGuards(JwtAuthGuard)
    async create(@Body() createTurmaDto: CreateTurmaDto): Promise<TurmaResponseDto> {
        console.log('Criando nova turma:', createTurmaDto);
        return this.turmasService.create(createTurmaDto);
    }

    @Put(':id')
    async update(@Param('id', ParseIntPipe) id: number, @Body() updateTurmaDto: UpdateTurmaDto): Promise<TurmaResponseDto> {
        console.log('Atualizando turma ID:', id, 'com dados:', updateTurmaDto);
        return this.turmasService.update(id, updateTurmaDto);
    }

    @Delete(':id')
    async delete(@Param('id', ParseIntPipe) id: number): Promise<{ message: string }> {
        console.log('Deletando turma ID:', id);
        await this.turmasService.delete(id);
        return { message: 'Turma deletada com sucesso' };
    }

    // Gerenciamento de Alunos na Turma

    @Get(':id/alunos')
    async getAlunosTurma(
        @Param('id', ParseIntPipe) id_turma: number,
        @Query('page', ParseIntPipe) page: number = 1,
        @Query('limit', ParseIntPipe) limit: number = 10,
    ): Promise<AlunosTurmaListResponseDto> {
        console.log('Buscando alunos da turma:', id_turma);
        return this.turmasService.getAlunosTurma(id_turma, page, limit);
    }

    @Post(':id/alunos')
    async addAlunoTurma(@Param('id', ParseIntPipe) id_turma: number, @Body() addAlunoDto: AddAlunoTurmaDto): Promise<AlunoTurmaResponseDto> {
        console.log('Adicionando aluno à turma:', id_turma, 'aluno:', addAlunoDto);
        return this.turmasService.addAlunoTurma(id_turma, addAlunoDto);
    }

    @Put(':id/alunos/:id_turma_aluno')
    async updateAlunoTurma(
        @Param('id', ParseIntPipe) id_turma: number,
        @Param('id_turma_aluno') id_turma_aluno: string,
        @Body() updateAlunoDto: UpdateAlunoTurmaDto,
    ): Promise<AlunoTurmaResponseDto> {
        console.log('Atualizando aluno na turma:', id_turma_aluno, 'com dados:', updateAlunoDto);
        return this.turmasService.updateAlunoTurma(id_turma_aluno, updateAlunoDto);
    }

    @Delete(':id/alunos/:id_turma_aluno')
    async removeAlunoTurma(@Param('id', ParseIntPipe) id_turma: number, @Param('id_turma_aluno') id_turma_aluno: string): Promise<{ message: string }> {
        console.log('Removendo aluno da turma:', id_turma_aluno);
        await this.turmasService.removeAlunoTurma(id_turma_aluno);
        return { message: 'Aluno removido da turma com sucesso' };
    }
}
