import { SetMetadata } from '@nestjs/common';
import {
    PERMISSION_METADATA_KEY,
    type ActionKey,
    type ModuleKey,
    type PermissionKey,
} from '../permissions.constants';

export type PermissionRequirement =
    | PermissionKey
    | {
          module: ModuleKey;
          action: ActionKey;
      };

export const RequirePermission = (permission: PermissionRequirement) => SetMetadata(PERMISSION_METADATA_KEY, permission);
