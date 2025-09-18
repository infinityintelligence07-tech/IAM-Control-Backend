import { Injectable } from '@nestjs/common';
import { UnitOfWorkService } from '../../config/unit_of_work/uow.service';
import { GetPolosDto, PolosListResponseDto, PoloResponseDto } from './dto/polos.dto';
import { Like, FindManyOptions, ILike } from 'typeorm';

@Injectable()
export class PolosService {
  constructor(private readonly uow: UnitOfWorkService) {}

  async findAll(filters: GetPolosDto): Promise<PolosListResponseDto> {
    const { page = 1, limit = 10, polo, cidade, estado } = filters;
    
    // Construir condições de busca
    const whereConditions: any = {};
    
    if (polo) {
      whereConditions.polo = ILike(`%${polo}%`);
    }
    
    if (cidade) {
      whereConditions.cidade = ILike(`%${cidade}%`);
    }
    
    if (estado) {
      whereConditions.estado = ILike(`%${estado}%`);
    }

    // Configurar opções de busca
    const findOptions: FindManyOptions = {
      where: whereConditions,
      order: {
        polo: 'ASC',
        criado_em: 'DESC'
      },
      skip: (page - 1) * limit,
      take: limit,
    };

    try {
      // Buscar polos com paginação
      const [polos, total] = await this.uow.polosRP.findAndCount(findOptions);

      // Buscar contagem de alunos para cada polo
      const polosWithCount = await Promise.all(
        polos.map(async (polo) => {
          const totalAlunos = await this.uow.alunosRP.count({
            where: { id_polo: polo.id }
          });

          return {
            id: polo.id,
            polo: polo.polo,
            cidade: polo.cidade,
            estado: polo.estado,
            created_at: polo.criado_em,
            updated_at: polo.atualizado_em,
            total_alunos: totalAlunos
          };
        })
      );

      const totalPages = Math.ceil(total / limit);

      return {
        data: polosWithCount,
        total,
        page,
        limit,
        totalPages
      };
    } catch (error) {
      console.error('Erro ao buscar polos:', error);
      throw new Error('Erro interno do servidor ao buscar polos');
    }
  }

  async findAllGrouped(): Promise<any> {
    try {
      // Buscar todos os polos
      const polos = await this.uow.polosRP.find({
        order: {
          polo: 'ASC',
          cidade: 'ASC'
        }
      });

      // Agrupar por nome do polo
      const groupedPolos = polos.reduce((acc, polo) => {
        const poloName = polo.polo;
        
        if (!acc[poloName]) {
          acc[poloName] = {
            nome: poloName,
            cidades: []
          };
        }

        acc[poloName].cidades.push({
          id: polo.id,
          cidade: polo.cidade,
          estado: polo.estado,
          created_at: polo.criado_em,
          updated_at: polo.atualizado_em
        });

        return acc;
      }, {} as any);

      // Buscar contagem de alunos para cada cidade
      const result = await Promise.all(
        Object.values(groupedPolos).map(async (grupo: any) => {
          const cidadesComCount = await Promise.all(
            grupo.cidades.map(async (cidade: any) => {
              const totalAlunos = await this.uow.alunosRP.count({
                where: { id_polo: cidade.id }
              });

              return {
                ...cidade,
                total_alunos: totalAlunos
              };
            })
          );

          return {
            ...grupo,
            cidades: cidadesComCount,
            total_cidades: cidadesComCount.length,
            total_alunos: cidadesComCount.reduce((sum, cidade) => sum + cidade.total_alunos, 0)
          };
        })
      );

      return result;
    } catch (error) {
      console.error('Erro ao buscar polos agrupados:', error);
      throw new Error('Erro interno do servidor ao buscar polos agrupados');
    }
  }

  async findById(id: number): Promise<PoloResponseDto | null> {
    try {
      const polo = await this.uow.polosRP.findOne({
        where: { id }
      });

      if (!polo) {
        return null;
      }

      const totalAlunos = await this.uow.alunosRP.count({
        where: { id_polo: polo.id }
      });

      return {
        id: polo.id,
        polo: polo.polo,
        cidade: polo.cidade,
        estado: polo.estado,
        created_at: polo.criado_em,
        updated_at: polo.atualizado_em,
        total_alunos: totalAlunos
      };
    } catch (error) {
      console.error('Erro ao buscar polo por ID:', error);
      throw new Error('Erro interno do servidor ao buscar polo');
    }
  }
}
