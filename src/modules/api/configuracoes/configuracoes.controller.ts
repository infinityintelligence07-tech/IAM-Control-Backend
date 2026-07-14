import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ConfiguracoesService } from './configuracoes.service';
import { ConfiguracoesResponseDto, UpdateConfiguracoesDto } from './dto/configuracoes.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { PermissionsGuard } from '@/modules/auth/guards/permissions.guard';
import { RequirePermission } from '@/modules/auth/decorators/require-permission.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission({ module: 'usuarios', action: 'view' })
@Controller('configuracoes')
export class ConfiguracoesController {
    constructor(private readonly configuracoesService: ConfiguracoesService) {}

    @Get()
    async findAll(): Promise<ConfiguracoesResponseDto> {
        return this.configuracoesService.findAll();
    }

    @Put()
    @RequirePermission({ module: 'usuarios', action: 'edit' })
    async update(@Body() dto: UpdateConfiguracoesDto): Promise<ConfiguracoesResponseDto> {
        return this.configuracoesService.upsertMany(dto);
    }
}
