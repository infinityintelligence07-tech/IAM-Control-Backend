import { Controller, Get, Post, Put, Delete, Query, Param, Body, UseInterceptors, ClassSerializerInterceptor, UseGuards } from '@nestjs/common';
import { PolosService } from './polos.service';
import { GetPolosDto, PolosListResponseDto, PoloResponseDto, CreatePoloDto, UpdatePoloDto, SoftDeletePoloDto } from './dto/polos.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { PermissionsGuard } from '@/modules/auth/guards/permissions.guard';
import { RequirePermission } from '@/modules/auth/decorators/require-permission.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission({ module: 'polos', action: 'view' })
@UseInterceptors(ClassSerializerInterceptor)
@Controller('polos')
export class PolosController {
    constructor(private readonly polosService: PolosService) {}

    @Get()
    async findAll(@Query() filters: GetPolosDto): Promise<PolosListResponseDto> {
        console.log('Buscando polos com filtros:', filters);
        return this.polosService.findAll(filters);
    }

    @Get('grouped')
    async findAllGrouped(): Promise<any> {
        console.log('Buscando polos agrupados');
        return this.polosService.findAllGrouped();
    }

    @Get(':id')
    async findById(@Param('id') id: number): Promise<PoloResponseDto | null> {
        console.log('Buscando polo por ID:', id);
        return this.polosService.findById(id);
    }

    @Post()
    @RequirePermission({ module: 'polos', action: 'create' })
    async create(@Body() createPoloDto: CreatePoloDto): Promise<PoloResponseDto> {
        console.log('Criando polo:', createPoloDto);
        return this.polosService.create(createPoloDto);
    }

    @Put(':id')
    @RequirePermission({ module: 'polos', action: 'edit' })
    async update(@Param('id') id: number, @Body() updatePoloDto: UpdatePoloDto): Promise<PoloResponseDto> {
        console.log('Atualizando polo ID:', id, 'Dados:', updatePoloDto);
        return this.polosService.update(id, updatePoloDto);
    }

    @Put(':id/soft-delete')
    @RequirePermission({ module: 'polos', action: 'delete' })
    async softDelete(@Param('id') id: number, @Body() softDeleteDto: SoftDeletePoloDto): Promise<{ message: string }> {
        console.log('Soft delete do polo ID:', id, 'Dados:', softDeleteDto);
        await this.polosService.softDelete(id, softDeleteDto);
        return { message: 'Polo marcado como deletado com sucesso' };
    }

    @Delete(':id')
    @RequirePermission({ module: 'polos', action: 'delete' })
    async delete(@Param('id') id: number): Promise<{ message: string }> {
        console.log('Excluindo polo ID (hard delete):', id);
        await this.polosService.delete(id);
        return { message: 'Polo excluído permanentemente' };
    }
}
