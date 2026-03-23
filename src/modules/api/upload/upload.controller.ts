import { Controller, Post, UploadedFile, UseInterceptors, UseGuards, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';
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
}
