import { Injectable, Inject } from '@nestjs/common';
import { Repository, EntityManager, DataSource, QueryRunner } from 'typeorm';

/*****************************************************************************/
/*                             Postgres Entities                             */
import { Alunos } from '../entities/alunos.entity';
import { Documentos } from '../entities/documentos.entity';
import { DocumentosVersoes } from '../entities/documentosVersoes.entity';
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
import { EnderecoEventos } from '../entities/enderecoEventos.entity';
import { AlunosVinculos } from '../entities/alunosVinculos.entity';
import { AlunosEmpresas } from '../entities/alunosEmpresas.entity';
import { HistoricoTransferenciasAlunos } from '../entities/historicoTransferenciasAlunos.entity';
import { PresentesSorteio } from '../entities/presentesSorteio.entity';
import { HistoricoSorteados } from '../entities/historicoSorteados.entity';
import { HistoricoAlunosTurmasLog } from '../entities/historicoAlunosTurmasLog.entity';
import { HistoricoTurmasLog } from '../entities/historicoTurmasLog.entity';
import { TurmasMetricasSnapshot } from '../entities/turmasMetricasSnapshot.entity';
import { ConfiguracoesSistema } from '../entities/configuracoesSistema.entity';
import { Empresas } from '../entities/empresas.entity';
import { Notificacoes } from '../entities/notificacoes.entity';
import { NotificacoesLeituras } from '../entities/notificacoesLeituras.entity';
import { DuvidasArtigos } from '../entities/duvidasArtigos.entity';
import { DuvidasConversas } from '../entities/duvidasConversas.entity';
import { DuvidasMensagens } from '../entities/duvidasMensagens.entity';
import { DuvidasSugestoes } from '../entities/duvidasSugestoes.entity';
/*****************************************************************************/

@Injectable()
export class UnitOfWorkService {
    constructor(@Inject('POSTGRES_DB') private readonly postgresDS: DataSource) {}

    private get postgresEM(): EntityManager {
        return this.postgresDS.manager;
    }

    /**
     * Atualiza o pico (máximo histórico) de inscritos e de alunos extras das turmas informadas.
     *
     * A meta de credenciados/confirmados é congelada sobre esses picos: transferências e
     * remoções NÃO reduzem o pico (e portanto a meta), mas novos máximos de inscritos/extras
     * elevam o pico. Recalcula de forma atômica a partir de `turmas_alunos`, então deve ser
     * chamado APÓS o commit da operação que inseriu/transferiu alunos (vendas, importação,
     * transferência, inclusão manual). Falhas são apenas logadas para não interromper o fluxo.
     *
     * Obs.: a definição de "extras" espelha `TurmasService.getContadoresListagemPorTurmas`
     * (bônus + transferência + sorteio). TRANSBORDO NÃO é extra (compra de ingresso/venda).
     * Mantenha as duas em sincronia.
     */
    async bumparPicoMetricasTurmas(ids: Array<number | string | null | undefined>): Promise<void> {
        const idsValidos = Array.from(new Set((ids || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0)));
        if (idsValidos.length === 0) return;

        try {
            await this.turmasRP.query(
                `
                UPDATE "turmas" t
                SET "meta_pico_inscritos" = GREATEST(COALESCE(t."meta_pico_inscritos", 0), c.inscritos),
                    "meta_pico_extras" = GREATEST(COALESCE(t."meta_pico_extras", 0), c.extras)
                FROM (
                    SELECT
                        ta."id_turma" AS id_turma,
                        COUNT(*)::int AS inscritos,
                        SUM(
                            CASE
                                WHEN ta."vaga_bonus" = true
                                    OR ta."origem_aluno" IN ('ALUNO_BONUS', 'TRANSFERENCIA', 'SORTEIO', 'PRESENTE')
                                THEN 1 ELSE 0
                            END
                        )::int AS extras
                    FROM "turmas_alunos" ta
                    WHERE ta."deletado_em" IS NULL
                      AND ta."id_turma" = ANY($1)
                    GROUP BY ta."id_turma"
                ) c
                WHERE t."id" = c.id_turma
                `,
                [idsValidos],
            );
        } catch (error) {
            console.error('Falha ao atualizar pico de métricas das turmas', idsValidos, error);
        }
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

    private _documentosVersoesRP?: Repository<DocumentosVersoes>;
    get documentosVersoesRP(): Repository<DocumentosVersoes> {
        if (!this._documentosVersoesRP) this._documentosVersoesRP = this.postgresEM.getRepository(DocumentosVersoes);
        return this._documentosVersoesRP;
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

    private _enderecoEventosRP?: Repository<EnderecoEventos>;
    get enderecoEventosRP(): Repository<EnderecoEventos> {
        if (!this._enderecoEventosRP) this._enderecoEventosRP = this.postgresEM.getRepository(EnderecoEventos);
        return this._enderecoEventosRP;
    }

    private _alunosVinculosRP?: Repository<AlunosVinculos>;
    get alunosVinculosRP(): Repository<AlunosVinculos> {
        if (!this._alunosVinculosRP) this._alunosVinculosRP = this.postgresEM.getRepository(AlunosVinculos);
        return this._alunosVinculosRP;
    }

    private _alunosEmpresasRP?: Repository<AlunosEmpresas>;
    get alunosEmpresasRP(): Repository<AlunosEmpresas> {
        if (!this._alunosEmpresasRP) this._alunosEmpresasRP = this.postgresEM.getRepository(AlunosEmpresas);
        return this._alunosEmpresasRP;
    }

    private _historicoTransferenciasRP?: Repository<HistoricoTransferenciasAlunos>;
    get historicoTransferenciasRP(): Repository<HistoricoTransferenciasAlunos> {
        if (!this._historicoTransferenciasRP) this._historicoTransferenciasRP = this.postgresEM.getRepository(HistoricoTransferenciasAlunos);
        return this._historicoTransferenciasRP;
    }

    private _presentesSorteioRP?: Repository<PresentesSorteio>;
    get presentesSorteioRP(): Repository<PresentesSorteio> {
        if (!this._presentesSorteioRP) this._presentesSorteioRP = this.postgresEM.getRepository(PresentesSorteio);
        return this._presentesSorteioRP;
    }

    private _historicoSorteadosRP?: Repository<HistoricoSorteados>;
    get historicoSorteadosRP(): Repository<HistoricoSorteados> {
        if (!this._historicoSorteadosRP) this._historicoSorteadosRP = this.postgresEM.getRepository(HistoricoSorteados);
        return this._historicoSorteadosRP;
    }

    private _historicoAlunosTurmasLogsRP?: Repository<HistoricoAlunosTurmasLog>;
    get historicoAlunosTurmasLogsRP(): Repository<HistoricoAlunosTurmasLog> {
        if (!this._historicoAlunosTurmasLogsRP) this._historicoAlunosTurmasLogsRP = this.postgresEM.getRepository(HistoricoAlunosTurmasLog);
        return this._historicoAlunosTurmasLogsRP;
    }

    private _historicoTurmasLogsRP?: Repository<HistoricoTurmasLog>;
    get historicoTurmasLogsRP(): Repository<HistoricoTurmasLog> {
        if (!this._historicoTurmasLogsRP) this._historicoTurmasLogsRP = this.postgresEM.getRepository(HistoricoTurmasLog);
        return this._historicoTurmasLogsRP;
    }

    private _turmasMetricasSnapshotRP?: Repository<TurmasMetricasSnapshot>;
    get turmasMetricasSnapshotRP(): Repository<TurmasMetricasSnapshot> {
        if (!this._turmasMetricasSnapshotRP) this._turmasMetricasSnapshotRP = this.postgresEM.getRepository(TurmasMetricasSnapshot);
        return this._turmasMetricasSnapshotRP;
    }

    private _configuracoesSistemaRP?: Repository<ConfiguracoesSistema>;
    get configuracoesSistemaRP(): Repository<ConfiguracoesSistema> {
        if (!this._configuracoesSistemaRP) this._configuracoesSistemaRP = this.postgresEM.getRepository(ConfiguracoesSistema);
        return this._configuracoesSistemaRP;
    }

    private _empresasRP?: Repository<Empresas>;
    get empresasRP(): Repository<Empresas> {
        if (!this._empresasRP) this._empresasRP = this.postgresEM.getRepository(Empresas);
        return this._empresasRP;
    }

    private _notificacoesRP?: Repository<Notificacoes>;
    get notificacoesRP(): Repository<Notificacoes> {
        if (!this._notificacoesRP) this._notificacoesRP = this.postgresEM.getRepository(Notificacoes);
        return this._notificacoesRP;
    }

    private _duvidasArtigosRP?: Repository<DuvidasArtigos>;
    get duvidasArtigosRP(): Repository<DuvidasArtigos> {
        if (!this._duvidasArtigosRP) this._duvidasArtigosRP = this.postgresEM.getRepository(DuvidasArtigos);
        return this._duvidasArtigosRP;
    }

    private _duvidasConversasRP?: Repository<DuvidasConversas>;
    get duvidasConversasRP(): Repository<DuvidasConversas> {
        if (!this._duvidasConversasRP) this._duvidasConversasRP = this.postgresEM.getRepository(DuvidasConversas);
        return this._duvidasConversasRP;
    }

    private _duvidasMensagensRP?: Repository<DuvidasMensagens>;
    get duvidasMensagensRP(): Repository<DuvidasMensagens> {
        if (!this._duvidasMensagensRP) this._duvidasMensagensRP = this.postgresEM.getRepository(DuvidasMensagens);
        return this._duvidasMensagensRP;
    }

    private _duvidasSugestoesRP?: Repository<DuvidasSugestoes>;
    get duvidasSugestoesRP(): Repository<DuvidasSugestoes> {
        if (!this._duvidasSugestoesRP) this._duvidasSugestoesRP = this.postgresEM.getRepository(DuvidasSugestoes);
        return this._duvidasSugestoesRP;
    }

    private _notificacoesLeiturasRP?: Repository<NotificacoesLeituras>;
    get notificacoesLeiturasRP(): Repository<NotificacoesLeituras> {
        if (!this._notificacoesLeiturasRP) this._notificacoesLeiturasRP = this.postgresEM.getRepository(NotificacoesLeituras);
        return this._notificacoesLeiturasRP;
    }
    /*****************************************************************************/
}
