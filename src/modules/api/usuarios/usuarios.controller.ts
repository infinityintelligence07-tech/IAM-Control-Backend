import { Controller, Get, Put, Delete, Query, Param, Body, UseInterceptors, ClassSerializerInterceptor, ParseIntPipe, UseGuards } from '@nestjs/common';
import { UsuariosService } from './usuarios.service';
import { GetUsuariosDto, UsuariosListResponseDto, UsuarioResponseDto, UpdateUsuarioDto, SoftDeleteUsuarioDto } from './dto/usuarios.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { AdminGuard } from '@/modules/auth/guards/admin.guard';

@UseGuards(JwtAuthGuard, AdminGuard)
@UseInterceptors(ClassSerializerInterceptor)
@Controller('usuarios')
export class UsuariosController {
    constructor(private readonly usuariosService: UsuariosService) {}

    @Get()
    async findAll(@Query() filters: GetUsuariosDto): Promise<UsuariosListResponseDto> {
        console.log('Buscando usuários com filtros:', filters);
        return this.usuariosService.findAll(filters);
    }

    @Get(':id')
    async findById(@Param('id', ParseIntPipe) id: number): Promise<UsuarioResponseDto | null> {
        console.log('Buscando usuário por ID:', id);
        return this.usuariosService.findById(id);
    }

    @Put(':id')
    async update(@Param('id', ParseIntPipe) id: number, @Body() updateUsuarioDto: UpdateUsuarioDto): Promise<UsuarioResponseDto> {
        console.log('Atualizando usuário ID:', id, 'Dados:', updateUsuarioDto);
        return this.usuariosService.update(id, updateUsuarioDto);
    }

    @Put(':id/soft-delete')
    async softDelete(@Param('id', ParseIntPipe) id: number, @Body() softDeleteDto: SoftDeleteUsuarioDto): Promise<void> {
        console.log('Fazendo soft delete do usuário ID:', id);
        return this.usuariosService.softDelete(id, softDeleteDto);
    }

    @Delete(':id')
    async delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
        console.log('Deletando permanentemente o usuário ID:', id);
        return this.usuariosService.delete(id);
    }
}
