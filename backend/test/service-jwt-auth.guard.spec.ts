import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, type JsonWebKey, type KeyObject } from 'node:crypto';
import test from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../src/auth/authenticated-request';
import { PublicRoute } from '../src/auth/public-route.decorator';
import { ServiceJwtAuthGuard } from '../src/auth/service-jwt-auth.guard';
import { ServiceJwtVerifier } from '../src/auth/service-jwt-verifier.service';

type SigningAlgorithm = 'RS256' | 'ES256';

interface TestKeyPair {
  kid: string;
  privateKey: KeyObject;
  publicJwk: JsonWebKey;
}

const jwksUrl = 'https://auth.example.test/.well-known/jwks.json';
const rsaKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rotatedRsaKeyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ecKeyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const testKeys: Record<SigningAlgorithm, TestKeyPair> = {
  ES256: { kid: 'test-es256-key', privateKey: ecKeyPair.privateKey, publicJwk: ecKeyPair.publicKey.export({ format: 'jwk' }) },
  RS256: { kid: 'test-rs256-key', privateKey: rsaKeyPair.privateKey, publicJwk: rsaKeyPair.publicKey.export({ format: 'jwk' }) },
};
const rotatedRs256Key: TestKeyPair = {
  kid: 'rotated-rs256-key',
  privateKey: rotatedRsaKeyPair.privateKey,
  publicJwk: rotatedRsaKeyPair.publicKey.export({ format: 'jwk' }),
};
let jwks: JsonWebKey[] = [];
let jwksFetchCount = 0;

delete process.env.SERVICE_JWT_SECRET;
process.env.SERVICE_JWT_ISSUER = 'school-platform-auth';
process.env.SERVICE_JWT_AUDIENCE = 'social-promotion-api';
process.env.SERVICE_JWT_JWKS_URL = jwksUrl;
process.env.SERVICE_JWT_JWKS_CACHE_TTL_MS = '10000';

globalThis.fetch = async (input) => {
  assert.equal(input, jwksUrl);
  jwksFetchCount += 1;
  return new Response(JSON.stringify({ keys: jwks }), { status: 200 });
};

function configureJwks(algorithm: SigningAlgorithm): void {
  const key = testKeys[algorithm];
  jwks = [{ ...key.publicJwk, alg: algorithm, kid: key.kid, use: 'sig' }];
  process.env.SERVICE_JWT_SIGNING_ALGORITHM = algorithm;
}

function signedToken(algorithm: SigningAlgorithm, overrides: Record<string, unknown> = {}): string {
  return signedTokenWithKey(algorithm, testKeys[algorithm], overrides);
}

function signedTokenWithKey(algorithm: SigningAlgorithm, key: TestKeyPair, overrides: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: algorithm, kid: key.kid, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user_001', iss: process.env.SERVICE_JWT_ISSUER, aud: process.env.SERVICE_JWT_AUDIENCE,
    exp: Math.floor(Date.now() / 1_000) + 60, ...overrides,
  })).toString('base64url');
  const input = Buffer.from(`${header}.${payload}`);
  const signature = algorithm === 'ES256'
    ? sign('sha256', input, { key: key.privateKey, dsaEncoding: 'ieee-p1363' })
    : sign('sha256', input, key.privateKey);
  return `${header}.${payload}.${signature.toString('base64url')}`;
}

function executionContext(request: AuthenticatedRequest, handler: () => void = () => undefined): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: <T>() => request as T }),
  } as unknown as ExecutionContext;
}

class TestController {}

test('service JWT verifier refuses a legacy shared secret at startup', () => {
  configureJwks('RS256');
  process.env.SERVICE_JWT_SECRET = 'deprecated-shared-secret';
  try {
    assert.throws(() => new ServiceJwtVerifier(), /SERVICE_JWT_SECRET must not be configured/);
  } finally {
    delete process.env.SERVICE_JWT_SECRET;
  }
});

test('Bearer service JWT guard verifies an RS256 JWKS token and maps sub to req.user.id', async () => {
  configureJwks('RS256');
  const request: AuthenticatedRequest = { headers: { authorization: `Bearer ${signedToken('RS256')}` } };
  const guard = new ServiceJwtAuthGuard(new Reflector(), new ServiceJwtVerifier());

  assert.equal(await guard.canActivate(executionContext(request)), true);
  assert.deepEqual(request.user, { id: 'user_001' });
});

test('Bearer service JWT guard verifies ES256 JWTs with an EC JWKS key', async () => {
  configureJwks('ES256');
  const request: AuthenticatedRequest = { headers: { authorization: `Bearer ${signedToken('ES256')}` } };
  const guard = new ServiceJwtAuthGuard(new Reflector(), new ServiceJwtVerifier());

  assert.equal(await guard.canActivate(executionContext(request)), true);
  assert.deepEqual(request.user, { id: 'user_001' });
});

test('an unknown kid triggers one JWKS refresh so a published RS256 signing-key rotation succeeds', async () => {
  configureJwks('RS256');
  const guard = new ServiceJwtAuthGuard(new Reflector(), new ServiceJwtVerifier());
  const initialRequest: AuthenticatedRequest = { headers: { authorization: `Bearer ${signedToken('RS256')}` } };
  await guard.canActivate(executionContext(initialRequest));
  const fetchCountBeforeRotation = jwksFetchCount;

  jwks = [{ ...rotatedRs256Key.publicJwk, alg: 'RS256', kid: rotatedRs256Key.kid, use: 'sig' }];
  const rotatedRequest: AuthenticatedRequest = {
    headers: { authorization: `Bearer ${signedTokenWithKey('RS256', rotatedRs256Key)}` },
  };

  assert.equal(await guard.canActivate(executionContext(rotatedRequest)), true);
  assert.equal(jwksFetchCount, fetchCountBeforeRotation + 1);
});

test('Bearer service JWT guard rejects absent, HS256, expired, invalid-audience, and tampered tokens', async () => {
  configureJwks('RS256');
  const guard = new ServiceJwtAuthGuard(new Reflector(), new ServiceJwtVerifier());
  const rejected = async (authorization: string | undefined) => {
    const request: AuthenticatedRequest = { headers: { authorization } };
    await assert.rejects(() => guard.canActivate(executionContext(request)), UnauthorizedException);
  };

  const hs256Header = Buffer.from(JSON.stringify({ alg: 'HS256', kid: testKeys.RS256.kid, typ: 'JWT' })).toString('base64url');
  const hs256Payload = Buffer.from(JSON.stringify({ sub: 'user_001' })).toString('base64url');
  await rejected(undefined);
  await rejected(`Bearer ${hs256Header}.${hs256Payload}.not-a-valid-signature`);
  await rejected(`Bearer ${signedToken('RS256', { exp: Math.floor(Date.now() / 1_000) - 1 })}`);
  await rejected(`Bearer ${signedToken('RS256', { aud: 'another-api' })}`);
  await rejected(`${`Bearer ${signedToken('RS256')}`}x`);
});

class ProviderCallbackController {
  @PublicRoute()
  callback(): void {}
}

test('explicit public routes bypass the service JWT guard for provider callbacks', async () => {
  const request: AuthenticatedRequest = { headers: {} };
  const guard = new ServiceJwtAuthGuard(new Reflector(), new ServiceJwtVerifier());
  const handler = ProviderCallbackController.prototype.callback;
  const context = {
    getHandler: () => handler,
    getClass: () => ProviderCallbackController,
    switchToHttp: () => ({ getRequest: <T>() => request as T }),
  } as unknown as ExecutionContext;

  assert.equal(await guard.canActivate(context), true);
  assert.equal(request.user, undefined);
});
