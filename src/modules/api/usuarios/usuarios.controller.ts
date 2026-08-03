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
import { PermissionsGuard } from '@/modules/auth/guards/permissions.guard';
import { RequirePermission } from '@/modules/auth/decorators/require-permission.decorator';

@UseInterceptors(ClassSerializerInterceptor)
@Controller('usuarios')
export class UsuariosController {
    constructor(private readonly usuariosService: UsuariosService) {}

    // Listagem liberada para qualquer usuário autenticado: o fluxo de venda
    // (seleção de testemunhas e autorização de pendência/diferença) precisa
    // listar todos os usuários independentemente do nível de acesso.
    @Get()
    @UseGuards(JwtAuthGuard)
    async findAll(@Query() filters: GetUsuariosDto): Promise<UsuariosListResponseDto> {
        return this.usuariosService.findAll(filters);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'usuarios', action: 'view' })
    async findById(@Param('id', ParseIntPipe) id: number): Promise<UsuarioResponseDto | null> {
        return this.usuariosService.findById(id);
    }

    @Put(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'usuarios', action: 'edit' })
    async update(
        @Param('id', ParseIntPipe) id: number,
        @Body() updateUsuarioDto: UpdateUsuarioDto,
        @Req() req: any,
    ): Promise<UsuarioResponseDto> {
        const atorId = req.user?.sub;
        if (!atorId) {
            throw new ForbiddenException('Usuário autenticado inválido.');
        }
        return this.usuariosService.update(id, updateUsuarioDto, atorId);
    }

    @Put(':id/aprovar')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'usuarios', action: 'edit' })
    async approve(@Param('id', ParseIntPipe) id: number, @Req() req: any): Promise<UsuarioResponseDto> {
        const aprovadoPor = req.user?.sub;
        if (!aprovadoPor) {
            throw new ForbiddenException('Usuário autenticado inválido para aprovar cadastro.');
        }
        return this.usuariosService.approve(id, aprovadoPor);
    }

    @Put(':id/soft-delete')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'usuarios', action: 'delete' })
    async softDelete(@Param('id', ParseIntPipe) id: number, @Body() softDeleteDto: SoftDeleteUsuarioDto): Promise<void> {
        return this.usuariosService.softDelete(id, softDeleteDto);
    }

    @Delete(':id')
    @UseGuards(JwtAuthGuard, PermissionsGuard)
    @RequirePermission({ module: 'usuarios', action: 'delete' })
    async delete(@Param('id', ParseIntPipe) id: number): Promise<void> {
        return this.usuariosService.delete(id);
    }
}
