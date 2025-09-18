import { BadRequestException } from '@nestjs/common';

export class PasswordValidator {
    static validate(password: string): void {
        if (!password) {
            throw new BadRequestException('Senha é obrigatória');
        }

        if (password.length < 8) {
            throw new BadRequestException('Senha deve ter no mínimo 8 caracteres');
        }

        if (password.length > 16) {
            throw new BadRequestException('Senha deve ter no máximo 16 caracteres');
        }

        if (!/[a-z]/.test(password)) {
            throw new BadRequestException('Senha deve conter ao menos uma letra minúscula');
        }

        if (!/[A-Z]/.test(password)) {
            throw new BadRequestException('Senha deve conter ao menos uma letra maiúscula');
        }

        if (!/\d/.test(password)) {
            throw new BadRequestException('Senha deve conter ao menos um número');
        }

        if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
            throw new BadRequestException('Senha deve conter ao menos um caractere especial');
        }
    }
}
