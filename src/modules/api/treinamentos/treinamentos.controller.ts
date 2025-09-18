import { Controller, Get, Query, UseGuards, UseInterceptors, ClassSerializerInterceptor } from '@nestjs/common';
import { TreinamentosService } from './treinamentos.service';
import { GetTreinamentosDto, TreinamentosListResponseDto, TreinamentoResponseDto } from './dto/treinamentos.dto';
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
    async findById(@Query('id') id: number): Promise<TreinamentoResponseDto | null> {
        console.log('Buscando treinamento por ID:', id);
        return this.treinamentosService.findById(id);
    }
}
