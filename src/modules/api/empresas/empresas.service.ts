import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ILike, In, Not } from 'typeorm';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { Empresas } from '../../config/entities/empresas.entity';
import {
    CreateEmpresaDto,
    EmpresaResponseDto,
    EmpresasListResponseDto,
    GetEmpresasDto,
    SetEmpresaTreinamentosDto,
    SoftDeleteEmpresaDto,
    UpdateEmpresaDto,
} from './dto/empresas.dto';
import { validateBase64ImageField } from '../shared/image-base64.validator';

@Injectable()
export class EmpresasService {
    constructor(private readonly uow: UnitOfWorkService) {}

    private async mapNomeUsuariosPorIds(ids: Array<number | null | undefined>): Promise<Map<number, string>> {
        const idsValidos = Array.from(new Set(ids.filter((id): id is number => Number.isFinite(Number(id)))));
        if (idsValidos.length === 0) {
            return new Map<number, string>();
        }

        const usuarios = await this.uow.usuariosRP.find({
            where: { id: In(idsValidos) } as any,
            select: ['id', 'nome'],
        });

        return new Map<number, string>(usuarios.map((usuario) => [usuario.id, usuario.nome]));
    }

    private async toResponseDto(empresa: Empresas, nomesAtualizadores?: Map<number, string>): Promise<EmpresaResponseDto> {
        const treinamentos = await this.uow.treinamentosRP.find({
            where: { id_empresa: empresa.id, deletado_em: null } as any,
            select: ['id', 'treinamento', 'sigla_treinamento', 'tipo_treinamento', 'tipo_palestra', 'tipo_mentoria', 'url_logo_treinamento'],
            order: { treinamento: 'ASC' } as any,
        });

        const nomes = nomesAtualizadores ?? (await this.mapNomeUsuariosPorIds([empresa.atualizado_por]));

        return {
            id: empresa.id,
            nome: empresa.nome,
            sigla: empresa.sigla ?? null,
            url_logo: empresa.url_logo ?? null,
            total_treinamentos: treinamentos.length,
            treinamentos: treinamentos.map((t) => ({
                id: t.id,
                treinamento: t.treinamento,
                sigla_treinamento: t.sigla_treinamento ?? null,
                tipo_treinamento: t.tipo_treinamento,
                tipo_palestra: t.tipo_palestra,
                tipo_mentoria: t.tipo_mentoria,
                url_logo_treinamento: t.url_logo_treinamento ?? null,
            })),
            created_at: empresa.criado_em instanceof Date ? empresa.criado_em.toISOString() : String(empresa.criado_em),
            updated_at: empresa.atualizado_em instanceof Date ? empresa.atualizado_em.toISOString() : String(empresa.atualizado_em),
            atualizado_por_nome: nomes.get(Number(empresa.atualizado_por)) || null,
        };
    }

    async findAll(filters: GetEmpresasDto): Promise<EmpresasListResponseDto> {
        try {
            const where: any = { deletado_em: null };
            if (filters.nome) {
                where.nome = ILike(`%${filters.nome}%`);
            }

            const empresas = await this.uow.empresasRP.find({
                where,
                order: { nome: 'ASC' } as any,
            });

            const nomesAtualizadores = await this.mapNomeUsuariosPorIds(empresas.map((e) => e.atualizado_por));
            const data = await Promise.all(empresas.map((empresa) => this.toResponseDto(empresa, nomesAtualizadores)));

            return { data, total: data.length };
        } catch (error) {
            console.error('Erro ao buscar empresas:', error);
            throw new Error('Erro interno do servidor ao buscar empresas');
        }
    }

    async findById(id: number): Promise<EmpresaResponseDto> {
        const empresa = await this.uow.empresasRP.findOne({ where: { id, deletado_em: null } as any });
        if (!empresa) {
            throw new NotFoundException(`Empresa com ID ${id} não encontrada`);
        }
        return this.toResponseDto(empresa);
    }

    async create(dto: CreateEmpresaDto): Promise<EmpresaResponseDto> {
        validateBase64ImageField(dto.url_logo, 'Logo da empresa');

        const existente = await this.uow.empresasRP.findOne({
            where: { nome: ILike(dto.nome), deletado_em: null } as any,
        });
        if (existente) {
            throw new BadRequestException(`Já existe uma empresa com o nome "${dto.nome}"`);
        }

        const empresa = new Empresas();
        empresa.nome = dto.nome;
        empresa.sigla = dto.sigla ?? null;
        empresa.url_logo = dto.url_logo ?? null;
        if (dto.criado_por !== undefined) {
            empresa.criado_por = dto.criado_por;
        }

        const salva = await this.uow.empresasRP.save(empresa);
        return this.toResponseDto(salva);
    }

    async update(id: number, dto: UpdateEmpresaDto): Promise<EmpresaResponseDto> {
        validateBase64ImageField(dto.url_logo ?? undefined, 'Logo da empresa');

        const empresa = await this.uow.empresasRP.findOne({ where: { id, deletado_em: null } as any });
        if (!empresa) {
            throw new NotFoundException(`Empresa com ID ${id} não encontrada`);
        }

        if (dto.nome !== undefined && dto.nome !== empresa.nome) {
            const duplicada = await this.uow.empresasRP.findOne({
                where: { nome: ILike(dto.nome), deletado_em: null, id: Not(id) } as any,
            });
            if (duplicada) {
                throw new BadRequestException(`Já existe uma empresa com o nome "${dto.nome}"`);
            }
            empresa.nome = dto.nome;
        }
        if (dto.sigla !== undefined) {
            empresa.sigla = dto.sigla || null;
        }
        if (dto.url_logo !== undefined) {
            empresa.url_logo = dto.url_logo || null;
        }
        if (dto.atualizado_por !== undefined) {
            empresa.atualizado_por = dto.atualizado_por;
        }

        const salva = await this.uow.empresasRP.save(empresa);
        return this.toResponseDto(salva);
    }

    async softDelete(id: number, dto: SoftDeleteEmpresaDto): Promise<void> {
        const empresa = await this.uow.empresasRP.findOne({ where: { id, deletado_em: null } as any });
        if (!empresa) {
            throw new NotFoundException(`Empresa com ID ${id} não encontrada`);
        }

        // Desvincula os treinamentos antes de remover a empresa (ficam "sem empresa").
        await this.uow.treinamentosRP.update({ id_empresa: id } as any, { id_empresa: null } as any);

        empresa.deletado_em = new Date();
        if (dto.atualizado_por !== undefined) {
            empresa.atualizado_por = dto.atualizado_por;
        }
        await this.uow.empresasRP.save(empresa);
    }

    /**
     * Define a lista completa de treinamentos vinculados à empresa: os ids
     * informados passam a apontar para ela (mesmo que estivessem em outra
     * empresa — mover = revincular) e os que saíram da lista são desvinculados.
     */
    async setTreinamentos(id: number, dto: SetEmpresaTreinamentosDto): Promise<EmpresaResponseDto> {
        const empresa = await this.uow.empresasRP.findOne({ where: { id, deletado_em: null } as any });
        if (!empresa) {
            throw new NotFoundException(`Empresa com ID ${id} não encontrada`);
        }

        const ids = Array.from(new Set((dto.ids || []).map((v) => Number(v)).filter((v) => Number.isInteger(v) && v > 0)));

        if (ids.length > 0) {
            const existentes = await this.uow.treinamentosRP.find({
                where: { id: In(ids), deletado_em: null } as any,
                select: ['id'],
            });
            const idsExistentes = new Set(existentes.map((t) => t.id));
            const invalidos = ids.filter((tid) => !idsExistentes.has(tid));
            if (invalidos.length > 0) {
                throw new BadRequestException(`Treinamento(s) não encontrado(s): ${invalidos.join(', ')}`);
            }
        }

        await this.uow.withTransaction(async (qr) => {
            // Desvincula os que saíram da lista.
            if (ids.length > 0) {
                await qr.manager
                    .createQueryBuilder()
                    .update('treinamentos')
                    .set({ id_empresa: null })
                    .where('id_empresa = :id AND id NOT IN (:...ids)', { id, ids })
                    .execute();
                await qr.manager.createQueryBuilder().update('treinamentos').set({ id_empresa: id }).where('id IN (:...ids)', { ids }).execute();
            } else {
                await qr.manager.createQueryBuilder().update('treinamentos').set({ id_empresa: null }).where('id_empresa = :id', { id }).execute();
            }
        });

        return this.toResponseDto(empresa);
    }
}
