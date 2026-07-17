import { BadRequestException } from '@nestjs/common';

export const IDADE_MINIMA_ALUNO_ANOS = 13;

/**
 * Garante idade mínima de 13 anos quando data_nascimento é informada.
 * Interpreta "YYYY-MM-DD" em horário local (não UTC).
 */
export function validarIdadeMinimaNascimentoAluno(
    dataNascimento?: string | null,
): void {
    if (dataNascimento == null || String(dataNascimento).trim() === '') {
        return;
    }
    const somenteData = String(dataNascimento).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(somenteData)) {
        throw new BadRequestException('Data de nascimento inválida.');
    }
    const [ano, mes, dia] = somenteData.split('-').map(Number);
    const nasc = new Date(ano, mes - 1, dia);
    if (
        Number.isNaN(nasc.getTime()) ||
        nasc.getFullYear() !== ano ||
        nasc.getMonth() !== mes - 1 ||
        nasc.getDate() !== dia
    ) {
        throw new BadRequestException('Data de nascimento inválida.');
    }
    const hoje = new Date();
    let idade = hoje.getFullYear() - nasc.getFullYear();
    const diffMes = hoje.getMonth() - nasc.getMonth();
    if (diffMes < 0 || (diffMes === 0 && hoje.getDate() < nasc.getDate())) {
        idade -= 1;
    }
    if (idade < IDADE_MINIMA_ALUNO_ANOS) {
        throw new BadRequestException(
            `A data de nascimento não pode indicar idade menor que ${IDADE_MINIMA_ALUNO_ANOS} anos.`,
        );
    }
}
