import { Injectable, Inject } from '@nestjs/common';
import { Repository, EntityManager, DataSource, QueryRunner } from 'typeorm';

/*****************************************************************************/
/*                             Postgres Entities                             */
import { Alunos } from '../entities/alunos.entity';
import { Documentos } from '../entities/documentos.entity';
import { PasswordRecoveryTokens } from '../entities/passwordRecoveryTokens.entity';
import { Polos } from '../entities/polos.entity';
import { Produtos } from '../entities/produtos.entity';
import { Treinamentos } from '../entities/treinamentos.entity';
import { Turmas } from '../entities/turmas.entity';
import { TurmasAlunos } from '../entities/turmasAlunos.entity';
import { TurmasAlunosProdutos } from '../entities/turmasAlunosProdutos.entity';
import { TurmasAlunosTreinamentos } from '../entities/turmasAlunosTreinamentos.entity';
import { TurmasAlunosTreinamentosBonus } from '../entities/turmasAlunosTreinamentosBonus.entity';
import { TurmasAlunosTreinamentosContratos } from '../entities/turmasAlunosTreinamentosContratos.entity';
import { MasterclassPreCadastros } from '../entities/masterclassPreCadastros.entity';
import { Usuarios } from '../entities/usuarios.entity';
/*****************************************************************************/

@Injectable()
export class UnitOfWorkService {
    constructor(@Inject('POSTGRES_DB') private readonly postgresDS: DataSource) {}

    private get postgresEM(): EntityManager {
        return this.postgresDS.manager;
    }

    // Método para iniciar e gerenciar uma transação com liberação do QueryRunner
    async withTransaction<T>(operation: (queryRunner: QueryRunner) => Promise<T>): Promise<T> {
        const queryRunner = this.postgresDS.createQueryRunner();
        await queryRunner.startTransaction();

        try {
            const result = await operation(queryRunner);
            await queryRunner.commitTransaction();
            return result;
        } catch (error) {
            console.error('Transaction failed', error); // Log the error
            await queryRunner.rollbackTransaction();
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    // Métodos para acessar repositórios, inicializados somente quando chamados pela primeira vez
    /*****************************************************************************/
    /*                           Postgres Repositories                           */
    private _alunosRP?: Repository<Alunos>;
    get alunosRP(): Repository<Alunos> {
        if (!this._alunosRP) this._alunosRP = this.postgresEM.getRepository(Alunos);
        return this._alunosRP;
    }

    private _documentosRP?: Repository<Documentos>;
    get documentosRP(): Repository<Documentos> {
        if (!this._documentosRP) this._documentosRP = this.postgresEM.getRepository(Documentos);
        return this._documentosRP;
    }

    private _passRecTokenRP?: Repository<PasswordRecoveryTokens>;
    get passRecTokenRP(): Repository<PasswordRecoveryTokens> {
        if (!this._passRecTokenRP) this._passRecTokenRP = this.postgresEM.getRepository(PasswordRecoveryTokens);
        return this._passRecTokenRP;
    }

    private _polosRP?: Repository<Polos>;
    get polosRP(): Repository<Polos> {
        if (!this._polosRP) this._polosRP = this.postgresEM.getRepository(Polos);
        return this._polosRP;
    }

    private _produtosRP?: Repository<Produtos>;
    get produtosRP(): Repository<Produtos> {
        if (!this._produtosRP) this._produtosRP = this.postgresEM.getRepository(Produtos);
        return this._produtosRP;
    }

    private _treinamentosRP?: Repository<Treinamentos>;
    get treinamentosRP(): Repository<Treinamentos> {
        if (!this._treinamentosRP) this._treinamentosRP = this.postgresEM.getRepository(Treinamentos);
        return this._treinamentosRP;
    }

    private _turmasRP?: Repository<Turmas>;
    get turmasRP(): Repository<Turmas> {
        if (!this._turmasRP) this._turmasRP = this.postgresEM.getRepository(Turmas);
        return this._turmasRP;
    }

    private _turmasAlunosRP?: Repository<TurmasAlunos>;
    get turmasAlunosRP(): Repository<TurmasAlunos> {
        if (!this._turmasAlunosRP) this._turmasAlunosRP = this.postgresEM.getRepository(TurmasAlunos);
        return this._turmasAlunosRP;
    }

    private _turmasAlunosProdutosRP?: Repository<TurmasAlunosProdutos>;
    get turmasAlunosProdutosRP(): Repository<TurmasAlunosProdutos> {
        if (!this._turmasAlunosProdutosRP) this._turmasAlunosProdutosRP = this.postgresEM.getRepository(TurmasAlunosProdutos);
        return this._turmasAlunosProdutosRP;
    }

    private _turmasAlunosTreinamentosRP?: Repository<TurmasAlunosTreinamentos>;
    get turmasAlunosTreinamentosRP(): Repository<TurmasAlunosTreinamentos> {
        if (!this._turmasAlunosTreinamentosRP) this._turmasAlunosTreinamentosRP = this.postgresEM.getRepository(TurmasAlunosTreinamentos);
        return this._turmasAlunosTreinamentosRP;
    }

    private _turmasAlunosTreinamentosBonusRP?: Repository<TurmasAlunosTreinamentosBonus>;
    get turmasAlunosTreinamentosBonusRP(): Repository<TurmasAlunosTreinamentosBonus> {
        if (!this._turmasAlunosTreinamentosBonusRP) this._turmasAlunosTreinamentosBonusRP = this.postgresEM.getRepository(TurmasAlunosTreinamentosBonus);
        return this._turmasAlunosTreinamentosBonusRP;
    }

    private _turmasAlunosTreinamentosContratosRP?: Repository<TurmasAlunosTreinamentosContratos>;
    get turmasAlunosTreinamentosContratosRP(): Repository<TurmasAlunosTreinamentosContratos> {
        if (!this._turmasAlunosTreinamentosContratosRP) this._turmasAlunosTreinamentosContratosRP = this.postgresEM.getRepository(TurmasAlunosTreinamentosContratos);
        return this._turmasAlunosTreinamentosContratosRP;
    }

    private _usuariosRP?: Repository<Usuarios>;
    get usuariosRP(): Repository<Usuarios> {
        if (!this._usuariosRP) this._usuariosRP = this.postgresEM.getRepository(Usuarios);
        return this._usuariosRP;
    }

    private _masterclassPreCadastrosRP?: Repository<MasterclassPreCadastros>;
    get masterclassPreCadastrosRP(): Repository<MasterclassPreCadastros> {
        if (!this._masterclassPreCadastrosRP) this._masterclassPreCadastrosRP = this.postgresEM.getRepository(MasterclassPreCadastros);
        return this._masterclassPreCadastrosRP;
    }
    /*****************************************************************************/
}
