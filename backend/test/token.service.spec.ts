import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import test from 'node:test';
import { TokenService } from '../src/auth/token.service';

const oldKey = Buffer.alloc(32, 1);
const currentKey = Buffer.alloc(32, 2);

process.env.OAUTH_TOKEN_ENCRYPTION_KEYS = JSON.stringify({
  v1: oldKey.toString('base64'),
  v2: currentKey.toString('base64'),
});
process.env.OAUTH_TOKEN_ENCRYPTION_KEY_VERSION = 'v2';
delete process.env.OAUTH_TOKEN_ENCRYPTION_KEY;

function encryptWith(version: string, key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [version, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

test('token encryption/decryption keeps a retained v1 ciphertext readable while encrypting new values with v2', () => {
  const service = new TokenService();
  const v1Ciphertext = encryptWith('v1', oldKey, 'old-provider-token');

  assert.equal(service.decrypt(v1Ciphertext), 'old-provider-token');

  const v2Ciphertext = service.encrypt('new-provider-token');
  assert.ok(v2Ciphertext.startsWith('v2.'));
  assert.equal(service.decrypt(v2Ciphertext), 'new-provider-token');
});

test('rejects ciphertexts for a removed key version and tampered encrypted payloads', () => {
  const service = new TokenService();
  const v1Ciphertext = encryptWith('v1', oldKey, 'old-provider-token');

  assert.throws(() => service.decrypt(v1Ciphertext.replace(/^v1\./, 'v3.')), /key version v3 is not configured/);
  assert.throws(() => service.decrypt(`${v1Ciphertext}tampered`), /could not be decrypted/);
});
