import { BadRequestException } from '@nestjs/common';

const MAX_IMAGE_SIZE_BYTES = 4 * 1024 * 1024;
const BASE64_IMAGE_REGEX = /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+$/;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

const getBase64Payload = (value: string) => value.split(',')[1]?.replace(/\s/g, '') || '';
const getBase64MimeType = (value: string) => value.split(';')[0]?.replace(/^data:/, '').toLowerCase() || '';

const getBase64ByteSize = (base64Payload: string) => {
    if (!base64Payload) return 0;
    const padding = base64Payload.endsWith('==') ? 2 : base64Payload.endsWith('=') ? 1 : 0;
    return Math.floor((base64Payload.length * 3) / 4) - padding;
};

export const validateBase64ImageField = (value: string | undefined | null, fieldLabel: string) => {
    if (value == null) return;
    const normalized = value.trim();
    if (!normalized) return;

    // Compatibilidade com dados antigos ainda salvos em URL.
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) return;

    if (!BASE64_IMAGE_REGEX.test(normalized)) {
        throw new BadRequestException(`${fieldLabel} deve ser uma imagem base64 válida (data URL).`);
    }

    const mimeType = getBase64MimeType(normalized);
    if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
        throw new BadRequestException(`${fieldLabel} deve ser uma imagem JPEG, PNG ou WEBP.`);
    }

    const byteSize = getBase64ByteSize(getBase64Payload(normalized));
    if (byteSize > MAX_IMAGE_SIZE_BYTES) {
        throw new BadRequestException(`${fieldLabel} deve ter no máximo 4MB.`);
    }
};
