import { Body, ClassSerializerInterceptor, Controller, Get, Param, Post, Put, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { EmpresasService } from './empresas.service';
import {
    CreateEmpresaDto,
    EmpresaResponseDto,
    EmpresasListResponseDto,
    GetEmpresasDto,
    SetEmpresaTreinamentosDto,
    SoftDeleteEmpresaDto,
    UpdateEmpresaDto,
} from './dto/empresas.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { PermissionsGuard } from '@/modules/auth/guards/permissions.guard';
import { RequirePermission } from '@/modules/auth/decorators/require-permission.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ClassSerializerInterceptor)
@Controller('empresas')
export class EmpresasController {
    constructor(private readonly empresasService: EmpresasService) {}

    // Leitura liberada a qualquer autenticado: o seletor global de empresa no
    // topo do sistema precisa da lista independentemente de setor/função.
    @Get()
    async findAll(@Query() filters: GetEmpresasDto): Promise<EmpresasListResponseDto> {
        return this.empresasService.findAll(filters);
    }

    @Get(':id')
    async findById(@Param('id') id: number): Promise<EmpresaResponseDto> {
        return this.empresasService.findById(id);
    }

    @Post()
    @RequirePermission({ module: 'empresas', action: 'create' })
    async create(@Body() dto: CreateEmpresaDto): Promise<EmpresaResponseDto> {
        return this.empresasService.create(dto);
    }

    @Put(':id')
    @RequirePermission({ module: 'empresas', action: 'edit' })
    async update(@Param('id') id: number, @Body() dto: UpdateEmpresaDto): Promise<EmpresaResponseDto> {
        return this.empresasService.update(id, dto);
    }

    @Put(':id/treinamentos')
    @RequirePermission({ module: 'empresas', action: 'edit' })
    async setTreinamentos(@Param('id') id: number, @Body() dto: SetEmpresaTreinamentosDto): Promise<EmpresaResponseDto> {
        return this.empresasService.setTreinamentos(id, dto);
    }

    @Put(':id/soft-delete')
    @RequirePermission({ module: 'empresas', action: 'delete' })
    async softDelete(@Param('id') id: number, @Body() dto: SoftDeleteEmpresaDto): Promise<{ message: string }> {
        await this.empresasService.softDelete(id, dto);
        return { message: 'Empresa removida com sucesso' };
    }
}
