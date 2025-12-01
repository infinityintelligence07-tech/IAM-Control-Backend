import { Controller, Get, UseGuards, UseInterceptors, ClassSerializerInterceptor } from '@nestjs/common';
import { RelatoriosFinanceiroService } from './relatorios-financeiro.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { AdminOrLiderGuard } from '@/modules/auth/guards/admin-or-lider.guard';
import { AlunosInadimplentesResponseDto } from './dto/relatorios-financeiro.dto';

@UseGuards(JwtAuthGuard, AdminOrLiderGuard)
@UseInterceptors(ClassSerializerInterceptor)
@Controller('relatorios/financeiro')
export class RelatoriosFinanceiroController {
    constructor(private readonly relatoriosFinanceiroService: RelatoriosFinanceiroService) {}

    @Get('alunos-inadimplentes')
    async getAlunosInadimplentes(): Promise<AlunosInadimplentesResponseDto> {
        return this.relatoriosFinanceiroService.getAlunosInadimplentes();
    }
}

