import { EventSubscriber, EntitySubscriberInterface, InsertEvent, UpdateEvent, SoftRemoveEvent, RecoverEvent } from 'typeorm';
import { BaseEntity } from '../entities/baseEntity.entity';
import { getRequestUserId } from '@/common/context/request-user.context';

@EventSubscriber()
export class AuditSubscriber implements EntitySubscriberInterface<BaseEntity> {
    listenTo() {
        return BaseEntity as any;
    }

    beforeInsert(event: InsertEvent<BaseEntity>): void {
        const userId = getRequestUserId();
        if (!userId || !event.entity) {
            return;
        }

        event.entity.criado_por = userId;
        event.entity.atualizado_por = userId;
    }

    beforeUpdate(event: UpdateEvent<BaseEntity>): void {
        const userId = getRequestUserId();
        if (!userId || !event.entity) {
            return;
        }

        event.entity.atualizado_por = userId;
    }

    beforeSoftRemove(event: SoftRemoveEvent<BaseEntity>): void {
        const userId = getRequestUserId();
        if (!userId || !event.entity) {
            return;
        }

        event.entity.atualizado_por = userId;
    }

    beforeRecover(event: RecoverEvent<BaseEntity>): void {
        const userId = getRequestUserId();
        if (!userId || !event.entity) {
            return;
        }

        event.entity.atualizado_por = userId;
    }
}

