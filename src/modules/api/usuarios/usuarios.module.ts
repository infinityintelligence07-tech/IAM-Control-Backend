import { Module } from '@nestjs/common';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';
import { UnitOfWorkModule } from '../../config/unit_of_work/uow.module';
import { AdminGuard } from '../../auth/guards/admin.guard';

@Module({
    imports: [UnitOfWorkModule],
    controllers: [UsuariosController],
    providers: [UsuariosService, AdminGuard],
    exports: [UsuariosService],
})
export class UsuariosModule {}
