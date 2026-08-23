import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const KEY_VERSION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

@Injectable()
export class TokenService {
  encrypt(plaintext: string): string {
    if (!plaintext) throw new TypeError('Cannot encrypt an empty secret.');
    const version = this.keyVersion();
    const key = this.key(version);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [version, iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  decrypt(payload: string): string {
    const parts = payload.split('.');
    if (parts.length !== 4) throw new TypeError('Unsupported encrypted secret payload.');
    const [version, ivEncoded, tagEncoded, ciphertextEncoded] = parts;
    if (!KEY_VERSION_PATTERN.test(version) || !this.isBase64Url(ivEncoded) || !this.isBase64Url(tagEncoded) || !this.isBase64Url(ciphertextEncoded)) {
      throw new TypeError('Unsupported encrypted secret payload.');
    }

    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key(version), Buffer.from(ivEncoded, 'base64url'));
      decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertextEncoded, 'base64url')), decipher.final()]).toString('utf8');
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new TypeError('Encrypted secret payload could not be decrypted.');
    }
  }

  keyVersion(): string {
    const version = process.env.OAUTH_TOKEN_ENCRYPTION_KEY_VERSION || 'v1';
    if (!KEY_VERSION_PATTERN.test(version)) throw new ServiceUnavailableException('OAuth token encryption key version is invalid.');
    return version;
  }

  private key(version: string): Buffer {
    const key = this.keyRing().get(version);
    if (!key) throw new ServiceUnavailableException(`OAuth token encryption key version ${version} is not configured.`);
    return key;
  }

  private keyRing(): ReadonlyMap<string, Buffer> {
    const encodedKeyRing = process.env.OAUTH_TOKEN_ENCRYPTION_KEYS;
    if (!encodedKeyRing) return this.legacyKeyRing();

    let parsed: unknown;
    try {
      parsed = JSON.parse(encodedKeyRing);
    } catch {
      throw new ServiceUnavailableException('OAUTH_TOKEN_ENCRYPTION_KEYS must be a JSON object of version-to-base64-key entries.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ServiceUnavailableException('OAUTH_TOKEN_ENCRYPTION_KEYS must be a JSON object of version-to-base64-key entries.');
    }

    const keys = new Map<string, Buffer>();
    for (const [version, encodedKey] of Object.entries(parsed)) {
      if (!KEY_VERSION_PATTERN.test(version) || typeof encodedKey !== 'string') {
        throw new ServiceUnavailableException('OAUTH_TOKEN_ENCRYPTION_KEYS contains an invalid key entry.');
      }
      keys.set(version, this.decodeKey(encodedKey));
    }
    if (keys.size === 0) throw new ServiceUnavailableException('OAUTH_TOKEN_ENCRYPTION_KEYS must contain at least one key.');
    return keys;
  }

  private legacyKeyRing(): ReadonlyMap<string, Buffer> {
    const encodedKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
    if (!encodedKey) throw new ServiceUnavailableException('OAuth token encryption is not configured.');
    return new Map([[this.keyVersion(), this.decodeKey(encodedKey)]]);
  }

  private decodeKey(encodedKey: string): Buffer {
    const key = Buffer.from(encodedKey, 'base64');
    if (key.length !== 32 || key.toString('base64') !== encodedKey) {
      throw new ServiceUnavailableException('OAuth token encryption keys must be base64-encoded 32-byte values.');
    }
    return key;
  }

  private isBase64Url(value: string): boolean {
    return value.length > 0 && value.length <= 16_384 && /^[A-Za-z0-9_-]+$/.test(value);
  }
}
