import {
    Body,
    ClassSerializerInterceptor,
    Controller,
    Get,
    Param,
    Post,
    Put,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { TurmaDisponibilidadeService } from './turma-disponibilidade.service';
import {
    CreateTurmaDisponibilidadeDto,
    GetTurmaDisponibilidadeDto,
    SoftDeleteTurmaDisponibilidadeDto,
    TurmaDisponibilidadeListResponseDto,
    TurmaDisponibilidadeResponseDto,
    UpdateTurmaDisponibilidadeDto,
} from './dto/turma-disponibilidade.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { PermissionsGuard } from '@/modules/auth/guards/permissions.guard';
import { RequirePermission } from '@/modules/auth/decorators/require-permission.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@UseInterceptors(ClassSerializerInterceptor)
@Controller('turma-disponibilidade')
export class TurmaDisponibilidadeController {
    constructor(private readonly service: TurmaDisponibilidadeService) {}

    @Get()
    @RequirePermission({ module: 'disponibilidadePitch', action: 'view' })
    async findAll(
        @Query() filters: GetTurmaDisponibilidadeDto,
    ): Promise<TurmaDisponibilidadeListResponseDto> {
        return this.service.findAll(filters);
    }

    @Get(':id')
    @RequirePermission({ module: 'disponibilidadePitch', action: 'view' })
    async findById(@Param('id') id: number): Promise<TurmaDisponibilidadeResponseDto> {
        return this.service.findById(Number(id));
    }

    @Post()
    @RequirePermission({ module: 'disponibilidadePitch', action: 'create' })
    async create(
        @Body() dto: CreateTurmaDisponibilidadeDto,
    ): Promise<TurmaDisponibilidadeResponseDto> {
        return this.service.create(dto);
    }

    @Put(':id')
    @RequirePermission({ module: 'disponibilidadePitch', action: 'edit' })
    async update(
        @Param('id') id: number,
        @Body() dto: UpdateTurmaDisponibilidadeDto,
    ): Promise<TurmaDisponibilidadeResponseDto> {
        return this.service.update(Number(id), dto);
    }

    @Put(':id/soft-delete')
    @RequirePermission({ module: 'disponibilidadePitch', action: 'delete' })
    async softDelete(
        @Param('id') id: number,
        @Body() dto: SoftDeleteTurmaDisponibilidadeDto,
    ): Promise<{ message: string }> {
        await this.service.softDelete(Number(id), dto);
        return { message: 'Registro removido com sucesso' };
    }
}
