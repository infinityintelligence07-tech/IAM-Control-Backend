import { Injectable } from '@nestjs/common';
import * as CryptoJS from 'crypto-js';

@Injectable()
export class EncryptionService {
    private readonly secretKey = process.env.ENCRYPTION_SECRET_KEY || 'default-secret-key-change-in-production';

    encrypt(text: string): string {
        return CryptoJS.AES.encrypt(text, this.secretKey).toString();
    }

    decrypt(encryptedText: string): string {
        try {
            const bytes = CryptoJS.AES.decrypt(encryptedText, this.secretKey);
            const decrypted = bytes.toString(CryptoJS.enc.Utf8);

            if (!decrypted) {
                throw new Error('Failed to decrypt data - invalid key or corrupted data');
            }

            return decrypted;
        } catch (error) {
            console.error('Decryption error:', error);
            throw new Error('Failed to decrypt data - invalid key or corrupted data');
        }
    }

    encryptObject(obj: any): string {
        return this.encrypt(JSON.stringify(obj));
    }

    decryptObject<T>(encryptedText: string): T {
        const decrypted = this.decrypt(encryptedText);
        return JSON.parse(decrypted);
    }
}
