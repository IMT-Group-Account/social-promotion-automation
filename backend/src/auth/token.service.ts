import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class TokenService {
  encrypt(plaintext: string): string {
    if (!plaintext) throw new TypeError('Cannot encrypt an empty secret.');
    const key = this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [this.keyVersion(), iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  decrypt(payload: string): string {
    const [version, ivEncoded, tagEncoded, ciphertextEncoded] = payload.split('.');
    if (version !== this.keyVersion() || !ivEncoded || !tagEncoded || !ciphertextEncoded) throw new TypeError('Unsupported encrypted secret payload.');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(ivEncoded, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, 'base64url')), decipher.final()]).toString('utf8');
  }

  keyVersion(): string { return process.env.OAUTH_TOKEN_ENCRYPTION_KEY_VERSION || 'v1'; }

  private key(): Buffer {
    const encoded = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    if (!encoded) throw new ServiceUnavailableException('OAuth token encryption is not configured.');
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) throw new ServiceUnavailableException('OAuth token encryption key must decode to 32 bytes.');
    return key;
  }
}
