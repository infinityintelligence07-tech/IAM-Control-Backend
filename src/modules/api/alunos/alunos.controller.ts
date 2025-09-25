import { Controller, Get, Post, Put, Delete, Query, Param, Body, UseInterceptors, ClassSerializerInterceptor, ParseIntPipe, UseGuards } from '@nestjs/common';
import { AlunosService } from './alunos.service';
import { GetAlunosDto, AlunosListResponseDto, AlunoResponseDto, CreateAlunoDto, UpdateAlunoDto, SoftDeleteAlunoDto } from './dto/alunos.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';

@UseGuards(JwtAuthGuard)
@UseInterceptors(ClassSerializerInterceptor)
@Controller('alunos')
export class AlunosController {
    constructor(private readonly alunosService: AlunosService) {}

    @Get()
    async findAll(@Query() filters: GetAlunosDto): Promise<AlunosListResponseDto> {
        console.log('Buscando alunos com filtros:', filters);
        return this.alunosService.findAll(filters);
    }

    @Get(':id')
    async findById(@Param('id', ParseIntPipe) id: number): Promise<AlunoResponseDto | null> {
        console.log('Buscando aluno por ID:', id);
        return this.alunosService.findById(id);
    }

    @Post()
    async create(@Body() createAlunoDto: CreateAlunoDto): Promise<AlunoResponseDto> {
        console.log('Criando aluno:', createAlunoDto);
        return this.alunosService.create(createAlunoDto);
    }

    @Put(':id')
    async update(@Param('id', ParseIntPipe) id: number, @Body() updateAlunoDto: UpdateAlunoDto): Promise<AlunoResponseDto> {
        console.log('Atualizando aluno ID:', id, 'Dados:', updateAlunoDto);
        return this.alunosService.update(id, updateAlunoDto);
    }

    @Put(':id/soft-delete')
    async softDelete(@Param('id', ParseIntPipe) id: number, @Body() softDeleteDto: SoftDeleteAlunoDto): Promise<{ message: string }> {
        console.log('Soft delete do aluno ID:', id, 'Dados:', softDeleteDto);
        await this.alunosService.softDelete(id, softDeleteDto);
        return { message: 'Aluno marcado como deletado com sucesso' };
    }

    @Delete(':id')
    async delete(@Param('id', ParseIntPipe) id: number): Promise<{ message: string }> {
        console.log('Excluindo aluno ID (hard delete):', id);
        await this.alunosService.delete(id);
        return { message: 'Aluno excluído permanentemente' };
    }
}
