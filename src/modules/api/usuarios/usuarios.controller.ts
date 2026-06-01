import {
    Controller,
    Get,
    Put,
    Delete,
    Query,
    Param,
    Body,
    UseInterceptors,
    ClassSerializerInterceptor,
    ParseIntPipe,
    UseGuards,
    Req,
    ForbiddenException,
} from '@nestjs/common';
import { UsuariosService } from './usuarios.service';
import { GetUsuariosDto, UsuariosListResponseDto, UsuarioResponseDto, UpdateUsuarioDto, SoftDeleteUsuarioDto } from './dto/usuarios.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { AdminGuard } from '@/modules/auth/guards/admin.guard';

@UseInterceptors(ClassSerializerInterceptor)
@Controller('usuarios')
export class UsuariosController {
    constructor(private readonly usuariosService: UsuariosService) {}

    @Get()
    @UseGuards(JwtAuthGuard)
    async findAll(@Query() filters: GetUsuariosDto, @Req() req: any): Promise<UsuariosListResponseDto> {
        console.log('[usuarios-url-debug][backend][controller] requisição recebida:', {
            originalUrl: req?.originalUrl,
            rawQuery: req?.query,
            transformedFilters: filters,
        });
        return this.usuariosService.findAll(filters);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    async findById(@Param('id', ParseIntPipe) id: number): Promise<UsuarioResponseDto | null> {
        console.log('Buscando usuário por ID:', id);
        return this.usuariosService.findById(id);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard, AdminGuard)
    async update(@Param('id', ParseIntPipe) id: number, @Body() updateUsuarioDto: UpdateUsuarioDto): Promise<UsuarioResponseDto> {
        console.log('Atualizando usuário ID:', id, 'Dados:', updateUsuarioDto);
        return this.usuariosService.update(id, updateUsuarioDto);
    }

    @Put(':id/aprovar')
    @UseGuards(JwtAuthGuard, AdminGuard)
    async approve(@Param('id', ParseIntPipe) id: number, @Req() req: any): Promise<UsuarioResponseDto> {
        const aprovadoPor = req.user?.sub;
        if (!aprovadoPor) {
            throw new ForbiddenException('Usuário autenticado inválido para aprovar cadastro.');
        }
        console.log('Aprovando usuário ID:', id, 'Aprovado por:', aprovadoPor);
        return this.usuariosService.approve(id, aprovadoPor);
    }

    @Put(':id/soft-delete')
    @UseGuards(JwtAuthGuard, AdminGuard)
    async softDelete(@Param('id', ParseIntPipe) id: number, @Body() softDeleteDto: SoftDeleteUsuarioDto): Promise<void> {
        console.log('Fazendo soft delete do usuário ID:', id);
        return this.usuariosService.softDelete(id, softDeleteDto);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, AdminGuard)
    async delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
        console.log('Deletando permanentemente o usuário ID:', id);
        return this.usuariosService.delete(id);
    }
}
