import { Allow, IsNumber, IsObject, IsOptional } from 'class-validator';
import type { PermissionsMatrix } from '../permissions.constants';

// Matriz v2: setor -> função -> módulo -> { view, create, edit, delete }

export class SavePermissionsMatrixDto {
    @IsOptional()
    @IsNumber()
    version?: number;

    @Allow()
    @IsObject()
    matrix: PermissionsMatrix;
}
