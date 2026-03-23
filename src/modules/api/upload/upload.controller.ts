import { Controller, Post, UploadedFile, UseInterceptors, UseGuards, BadRequestException, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportarAlunosPlanilhaResponse, UploadService } from './upload.service';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';
import { memoryStorage } from 'multer';

@Controller('upload')
export class UploadController {
    constructor(private readonly uploadService: UploadService) {}

    // Endpoint autenticado (admin cadastrando aluno)
    @UseGuards(JwtAuthGuard)
    @Post('foto-aluno')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
        }),
    )
    async uploadFotoAluno(@UploadedFile() file: Express.Multer.File): Promise<{ url: string }> {
        if (!file) throw new BadRequestException('Nenhum arquivo enviado');
        const url = await this.uploadService.uploadFotoAluno(file);
        return { url };
    }

    // Endpoint público (aluno preenchendo próprios dados via token)
    @Post('foto-aluno-publico')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
        }),
    )
    async uploadFotoAlunoPublico(@UploadedFile() file: Express.Multer.File): Promise<{ url: string }> {
        if (!file) throw new BadRequestException('Nenhum arquivo enviado');
        const url = await this.uploadService.uploadFotoAluno(file);
        return { url };
    }

    @UseGuards(JwtAuthGuard)
    @Post('alunos-planilha')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
        }),
    )
    async uploadAlunosPlanilha(@UploadedFile() file: Express.Multer.File, @Body() body: any): Promise<ImportarAlunosPlanilhaResponse> {
        if (!file) throw new BadRequestException('Nenhum arquivo enviado');

        const idTurma = parseInt(body?.id_turma, 10);
        if (Number.isNaN(idTurma)) {
            throw new BadRequestException('Campo id_turma é obrigatório e deve ser um número válido');
        }

        const confirmar = String(body?.confirmar || 'false').toLowerCase() === 'true';
        return this.uploadService.importarAlunosPlanilha(idTurma, file, confirmar);
    }
}
