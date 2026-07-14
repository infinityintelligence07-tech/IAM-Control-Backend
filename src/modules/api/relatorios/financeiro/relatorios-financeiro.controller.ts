import { Controller, Get, UseGuards, UseInterceptors, ClassSerializerInterceptor } from '@nestjs/common';
import { RelatoriosFinanceiroService } from './relatorios-financeiro.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { PermissionsGuard } from '@/modules/auth/guards/permissions.guard';
import { RequirePermission } from '@/modules/auth/decorators/require-permission.decorator';
import { AlunosInadimplentesResponseDto } from './dto/relatorios-financeiro.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission({ module: 'relatorios', action: 'view' })
@UseInterceptors(ClassSerializerInterceptor)
@Controller('relatorios/financeiro')
export class RelatoriosFinanceiroController {
    constructor(private readonly relatoriosFinanceiroService: RelatoriosFinanceiroService) {}

    @Get('alunos-inadimplentes')
    async getAlunosInadimplentes(): Promise<AlunosInadimplentesResponseDto> {
        return this.relatoriosFinanceiroService.getAlunosInadimplentes();
    }
}
