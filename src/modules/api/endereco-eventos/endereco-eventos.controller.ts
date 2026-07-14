import { Controller, Get, Post, Put, Query, Param, Body, UseInterceptors, ClassSerializerInterceptor, ParseIntPipe, UseGuards } from '@nestjs/common';
import { EnderecoEventosService } from './endereco-eventos.service';
import {
    GetEnderecoEventosDto,
    EnderecoEventosListResponseDto,
    EnderecoEventoResponseDto,
    CreateEnderecoEventoDto,
    UpdateEnderecoEventoDto,
    SoftDeleteEnderecoEventoDto,
} from './dto/endereco-eventos.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { PermissionsGuard } from '@/modules/auth/guards/permissions.guard';
import { RequirePermission } from '@/modules/auth/decorators/require-permission.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission({ module: 'enderecosEventos', action: 'view' })
@UseInterceptors(ClassSerializerInterceptor)
@Controller('endereco-eventos')
export class EnderecoEventosController {
    constructor(private readonly enderecoEventosService: EnderecoEventosService) {}

    @Get()
    async findAll(@Query() filters: GetEnderecoEventosDto): Promise<EnderecoEventosListResponseDto> {
        return this.enderecoEventosService.findAll(filters);
    }

    @Get(':id')
    async findById(@Param('id', ParseIntPipe) id: number): Promise<EnderecoEventoResponseDto | null> {
        return this.enderecoEventosService.findById(id);
    }

    @Post()
    @RequirePermission({ module: 'enderecosEventos', action: 'create' })
    async create(@Body() createEnderecoEventoDto: CreateEnderecoEventoDto): Promise<EnderecoEventoResponseDto> {
        return this.enderecoEventosService.create(createEnderecoEventoDto);
    }

    @Put(':id')
    @RequirePermission({ module: 'enderecosEventos', action: 'edit' })
    async update(@Param('id', ParseIntPipe) id: number, @Body() updateEnderecoEventoDto: UpdateEnderecoEventoDto): Promise<EnderecoEventoResponseDto> {
        return this.enderecoEventosService.update(id, updateEnderecoEventoDto);
    }

    @Put(':id/soft-delete')
    @RequirePermission({ module: 'enderecosEventos', action: 'delete' })
    async softDelete(@Param('id', ParseIntPipe) id: number, @Body() softDeleteDto: SoftDeleteEnderecoEventoDto): Promise<void> {
        return this.enderecoEventosService.softDelete(id, softDeleteDto);
    }
}
