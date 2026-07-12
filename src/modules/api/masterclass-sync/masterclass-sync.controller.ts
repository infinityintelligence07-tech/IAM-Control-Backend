import { Controller, Post, UseGuards } from '@nestjs/common';
import { MasterclassSyncService } from './masterclass-sync.service';
import { MasterclassSyncResult } from './dto/masterclass-feed.dto';
import { JwtAuthGuard } from '@/modules/auth/guards/jwt.guard';

@Controller('masterclass-sync')
@UseGuards(JwtAuthGuard)
export class MasterclassSyncController {
    constructor(private readonly masterclassSyncService: MasterclassSyncService) {}

    /**
     * Dispara manualmente a sincronização das masterclasses do feed externo.
     * A rotina automática roda diariamente via cron (MASTERCLASS_SYNC_CRON).
     */
    @Post('sincronizar')
    async sincronizar(): Promise<MasterclassSyncResult> {
        return this.masterclassSyncService.sincronizar();
    }
}
