import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ConfiguracoesService } from './configuracoes.service';
import { ConfiguracoesResponseDto, UpdateConfiguracoesDto } from './dto/configuracoes.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';

@UseGuards(JwtAuthGuard)
@Controller('configuracoes')
export class ConfiguracoesController {
    constructor(private readonly configuracoesService: ConfiguracoesService) {}

    @Get()
    async findAll(): Promise<ConfiguracoesResponseDto> {
        return this.configuracoesService.findAll();
    }

    @Put()
    async update(@Body() dto: UpdateConfiguracoesDto): Promise<ConfiguracoesResponseDto> {
        return this.configuracoesService.upsertMany(dto);
    }
}
