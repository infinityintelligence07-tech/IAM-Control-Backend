import { Controller, Get, Query, Param, UseInterceptors, ClassSerializerInterceptor, ParseIntPipe } from '@nestjs/common';
import { AlunosService } from './alunos.service';
import { GetAlunosDto, AlunosListResponseDto, AlunoResponseDto } from './dto/alunos.dto';

@Controller('alunos')
@UseInterceptors(ClassSerializerInterceptor)
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
}
