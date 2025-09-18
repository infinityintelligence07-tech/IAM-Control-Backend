import { Module } from '@nestjs/common';
// import { UsuariosModule } from './usuarios/usuarios.module';
import { PolosModule } from './polos/polos.module';
import { AlunosModule } from './alunos/alunos.module';
import { TreinamentosModule } from './treinamentos/treinamentos.module';
import { TurmasModule } from './turmas/turmas.module';

@Module({
    imports: [AlunosModule, PolosModule, TreinamentosModule, TurmasModule],
    // imports: [AlunosModule, PolosModule, TreinamentosModule, TurmasModule, UsuariosModule],
})
export class ApiModule {}
