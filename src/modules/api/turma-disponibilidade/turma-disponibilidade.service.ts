import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { In, IsNull } from 'typeorm';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { TurmaDisponibilidade } from '../../config/entities/turmaDisponibilidade.entity';
import {
    CreateTurmaDisponibilidadeDto,
    GetTurmaDisponibilidadeDto,
    SoftDeleteTurmaDisponibilidadeDto,
    TurmaDisponibilidadeListResponseDto,
    TurmaDisponibilidadeResponseDto,
    UpdateTurmaDisponibilidadeDto,
} from './dto/turma-disponibilidade.dto';

@Injectable()
export class TurmaDisponibilidadeService {
    constructor(private readonly uow: UnitOfWorkService) {}

    private toIso(value: Date | string | null | undefined): string {
        if (!value) return '';
        if (value instanceof Date) return value.toISOString();
        return String(value);
    }

    private normalizarQtd(valor: number | undefined | null): number {
        const n = Number(valor ?? 0);
        if (!Number.isFinite(n) || n < 0) {
            throw new BadRequestException('Quantidades devem ser números inteiros ≥ 0.');
        }
        return Math.trunc(n);
    }

    private async mapNomeUsuariosPorIds(
        ids: Array<number | null | undefined>,
    ): Promise<Map<number, string>> {
        const idsValidos = Array.from(
            new Set(ids.filter((id): id is number => Number.isFinite(Number(id)))),
        );
        if (idsValidos.length === 0) return new Map();

        const usuarios = await this.uow.usuariosRP.find({
            where: { id: In(idsValidos) } as any,
            select: ['id', 'nome'],
        });
        return new Map(usuarios.map((u) => [u.id, u.nome]));
    }

    private async ensureTurmaExiste(idTurma: number): Promise<void> {
        const turma = await this.uow.turmasRP.findOne({
            where: { id: idTurma, deletado_em: IsNull() } as any,
            select: ['id'],
        });
        if (!turma) {
            throw new NotFoundException(`Turma com ID ${idTurma} não encontrada`);
        }
    }

    private async toResponseDto(
        registro: TurmaDisponibilidade,
        nomes?: Map<number, string>,
    ): Promise<TurmaDisponibilidadeResponseDto> {
        const nomesMap =
            nomes ??
            (await this.mapNomeUsuariosPorIds([registro.criado_por, registro.atualizado_por]));

        const turma = registro.turma as
            | (TurmaDisponibilidade['turma'] & {
                  id_treinamento_fk?: { treinamento?: string; sigla_treinamento?: string };
              })
            | undefined;

        return {
            id: registro.id,
            id_turma: registro.id_turma,
            data_hora: this.toIso(registro.data_hora),
            qtd_manha: registro.qtd_manha,
            qtd_tarde: registro.qtd_tarde,
            qtd_noite: registro.qtd_noite,
            qtd_fila_pitch: registro.qtd_fila_pitch,
            qtd_fila_repitch: registro.qtd_fila_repitch,
            observacao: registro.observacao ?? null,
            turma: turma
                ? {
                      id: turma.id,
                      edicao_turma: turma.edicao_turma ?? null,
                      id_treinamento: turma.id_treinamento,
                      treinamento: turma.id_treinamento_fk?.treinamento ?? null,
                      sigla_treinamento: turma.id_treinamento_fk?.sigla_treinamento ?? null,
                  }
                : null,
            criado_em: this.toIso(registro.criado_em),
            atualizado_em: this.toIso(registro.atualizado_em),
            criado_por_nome: nomesMap.get(Number(registro.criado_por)) || null,
            atualizado_por_nome: nomesMap.get(Number(registro.atualizado_por)) || null,
        };
    }

    async findAll(filters: GetTurmaDisponibilidadeDto): Promise<TurmaDisponibilidadeListResponseDto> {
        const qb = this.uow.turmaDisponibilidadeRP
            .createQueryBuilder('reg')
            .leftJoinAndSelect('reg.turma', 'turma')
            .leftJoinAndSelect('turma.id_treinamento_fk', 'treinamento')
            .where('reg.deletado_em IS NULL')
            .andWhere('turma.deletado_em IS NULL')
            .orderBy('reg.data_hora', 'DESC')
            .addOrderBy('reg.id', 'DESC');

        if (filters.id_turma) {
            qb.andWhere('reg.id_turma = :idTurma', { idTurma: Number(filters.id_turma) });
        }

        if (filters.id_empresa != null && Number.isFinite(Number(filters.id_empresa))) {
            qb.andWhere('treinamento.id_empresa = :idEmpresa', {
                idEmpresa: Number(filters.id_empresa),
            });
        }

        const registros = await qb.getMany();
        const nomes = await this.mapNomeUsuariosPorIds(
            registros.flatMap((r) => [r.criado_por, r.atualizado_por]),
        );
        const data = await Promise.all(registros.map((r) => this.toResponseDto(r, nomes)));
        return { data, total: data.length };
    }

    async findById(id: number): Promise<TurmaDisponibilidadeResponseDto> {
        const registro = await this.uow.turmaDisponibilidadeRP.findOne({
            where: { id, deletado_em: IsNull() } as any,
            relations: ['turma', 'turma.id_treinamento_fk'],
        });
        if (!registro) {
            throw new NotFoundException(`Registro de disponibilidade com ID ${id} não encontrado`);
        }
        return this.toResponseDto(registro);
    }

    async create(dto: CreateTurmaDisponibilidadeDto): Promise<TurmaDisponibilidadeResponseDto> {
        await this.ensureTurmaExiste(Number(dto.id_turma));

        const dataHora = new Date(dto.data_hora);
        if (Number.isNaN(dataHora.getTime())) {
            throw new BadRequestException('Data/hora inválida.');
        }

        const entity = this.uow.turmaDisponibilidadeRP.create({
            id_turma: Number(dto.id_turma),
            data_hora: dataHora,
            qtd_manha: this.normalizarQtd(dto.qtd_manha),
            qtd_tarde: this.normalizarQtd(dto.qtd_tarde),
            qtd_noite: this.normalizarQtd(dto.qtd_noite),
            qtd_fila_pitch: this.normalizarQtd(dto.qtd_fila_pitch),
            qtd_fila_repitch: this.normalizarQtd(dto.qtd_fila_repitch),
            observacao: dto.observacao?.trim() || null,
            criado_por: dto.criado_por,
        });

        const saved = await this.uow.turmaDisponibilidadeRP.save(entity);
        return this.findById(saved.id);
    }

    async update(
        id: number,
        dto: UpdateTurmaDisponibilidadeDto,
    ): Promise<TurmaDisponibilidadeResponseDto> {
        const registro = await this.uow.turmaDisponibilidadeRP.findOne({
            where: { id, deletado_em: IsNull() } as any,
        });
        if (!registro) {
            throw new NotFoundException(`Registro de disponibilidade com ID ${id} não encontrado`);
        }

        if (dto.id_turma != null) {
            await this.ensureTurmaExiste(Number(dto.id_turma));
            registro.id_turma = Number(dto.id_turma);
        }

        if (dto.data_hora != null) {
            const dataHora = new Date(dto.data_hora);
            if (Number.isNaN(dataHora.getTime())) {
                throw new BadRequestException('Data/hora inválida.');
            }
            registro.data_hora = dataHora;
        }

        if (dto.qtd_manha !== undefined) registro.qtd_manha = this.normalizarQtd(dto.qtd_manha);
        if (dto.qtd_tarde !== undefined) registro.qtd_tarde = this.normalizarQtd(dto.qtd_tarde);
        if (dto.qtd_noite !== undefined) registro.qtd_noite = this.normalizarQtd(dto.qtd_noite);
        if (dto.qtd_fila_pitch !== undefined) {
            registro.qtd_fila_pitch = this.normalizarQtd(dto.qtd_fila_pitch);
        }
        if (dto.qtd_fila_repitch !== undefined) {
            registro.qtd_fila_repitch = this.normalizarQtd(dto.qtd_fila_repitch);
        }
        if (dto.observacao !== undefined) {
            registro.observacao = dto.observacao?.trim() || null;
        }
        if (dto.atualizado_por != null) {
            registro.atualizado_por = dto.atualizado_por;
        }

        await this.uow.turmaDisponibilidadeRP.save(registro);
        return this.findById(id);
    }

    async softDelete(id: number, dto: SoftDeleteTurmaDisponibilidadeDto): Promise<void> {
        const registro = await this.uow.turmaDisponibilidadeRP.findOne({
            where: { id, deletado_em: IsNull() } as any,
        });
        if (!registro) {
            throw new NotFoundException(`Registro de disponibilidade com ID ${id} não encontrado`);
        }

        if (dto.atualizado_por != null) {
            registro.atualizado_por = dto.atualizado_por;
        }
        registro.deletado_em = new Date();
        await this.uow.turmaDisponibilidadeRP.save(registro);
    }
}
