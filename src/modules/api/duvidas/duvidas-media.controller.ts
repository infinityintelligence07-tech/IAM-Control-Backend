import { BadRequestException, Controller, Get, NotFoundException, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Serve imagens da Central de Dúvidas sem JWT (necessário para <img src>).
 * Query: /api/duvidas-media?path=IAM%20Brain/.../venda-01.png
 */
@Controller('duvidas-media')
export class DuvidasMediaController {
    @Get()
    async servir(@Query('path') pathQuery: string, @Res() res: Response) {
        if (!pathQuery?.trim()) {
            throw new BadRequestException('Parâmetro path é obrigatório');
        }

        const rel = decodeURIComponent(pathQuery.trim()).replace(/\\/g, '/').replace(/^\/+/, '');
        if (!rel || rel.includes('..')) {
            throw new BadRequestException('Caminho inválido');
        }

        const root = path.resolve(process.cwd(), 'uploads', 'duvidas');
        const abs = path.resolve(root, rel);
        if (!abs.startsWith(root + path.sep) && abs !== root) {
            throw new BadRequestException('Caminho inválido');
        }
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
            throw new NotFoundException('Imagem não encontrada');
        }

        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(abs);
    }
}
