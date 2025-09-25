import { Controller, Get, Post, Put, Delete, Query, Param, Body, UseGuards, UseInterceptors, ClassSerializerInterceptor } from '@nestjs/common';
import { TreinamentosService } from './treinamentos.service';
import {
    GetTreinamentosDto,
    TreinamentosListResponseDto,
    TreinamentoResponseDto,
    CreateTreinamentoDto,
    UpdateTreinamentoDto,
    SoftDeleteTreinamentoDto,
} from './dto/treinamentos.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';

@UseGuards(JwtAuthGuard)
@UseInterceptors(ClassSerializerInterceptor)
@Controller('treinamentos')
export class TreinamentosController {
    constructor(private readonly treinamentosService: TreinamentosService) {}

    @Get()
    async findAll(@Query() filters: GetTreinamentosDto): Promise<TreinamentosListResponseDto> {
        console.log('Buscando treinamentos com filtros:', filters);
        return this.treinamentosService.findAll(filters);
    }

    @Get(':id')
    async findById(@Param('id') id: number): Promise<TreinamentoResponseDto | null> {
        console.log('Buscando treinamento por ID:', id);
        return this.treinamentosService.findById(id);
    }

    @Post()
    async create(@Body() createTreinamentoDto: CreateTreinamentoDto): Promise<TreinamentoResponseDto> {
        console.log('Criando treinamento:', createTreinamentoDto);
        return this.treinamentosService.create(createTreinamentoDto);
    }

    @Put(':id')
    async update(@Param('id') id: number, @Body() updateTreinamentoDto: UpdateTreinamentoDto): Promise<TreinamentoResponseDto> {
        console.log('Atualizando treinamento ID:', id, 'Dados:', updateTreinamentoDto);
        return this.treinamentosService.update(id, updateTreinamentoDto);
    }

    @Put(':id/soft-delete')
    async softDelete(@Param('id') id: number, @Body() softDeleteDto: SoftDeleteTreinamentoDto): Promise<{ message: string }> {
        console.log('Soft delete do treinamento ID:', id, 'Dados:', softDeleteDto);
        await this.treinamentosService.softDelete(id, softDeleteDto);
        return { message: 'Treinamento marcado como deletado com sucesso' };
    }

    @Delete(':id')
    async delete(@Param('id') id: number): Promise<{ message: string }> {
        console.log('Excluindo treinamento ID (hard delete):', id);
        await this.treinamentosService.delete(id);
        return { message: 'Treinamento excluído permanentemente' };
    }
}
