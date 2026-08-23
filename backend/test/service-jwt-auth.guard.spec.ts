import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../src/auth/authenticated-request';
import { PublicRoute } from '../src/auth/public-route.decorator';
import { ServiceJwtAuthGuard } from '../src/auth/service-jwt-auth.guard';
import { ServiceJwtVerifier } from '../src/auth/service-jwt-verifier.service';

process.env.SERVICE_JWT_SECRET = 'test-service-jwt-secret-that-is-at-least-32-bytes';
process.env.SERVICE_JWT_ISSUER = 'school-platform-auth';
process.env.SERVICE_JWT_AUDIENCE = 'social-promotion-api';

const jwtConfiguration = {
  audience: process.env.SERVICE_JWT_AUDIENCE,
  issuer: process.env.SERVICE_JWT_ISSUER,
  secret: process.env.SERVICE_JWT_SECRET,
};

function signedToken(overrides: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user_001', iss: jwtConfiguration.issuer, aud: jwtConfiguration.audience,
    exp: Math.floor(Date.now() / 1_000) + 60, ...overrides,
  })).toString('base64url');
  const signature = createHmac('sha256', jwtConfiguration.secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function executionContext(request: AuthenticatedRequest, handler: () => void = () => undefined): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: <T>() => request as T }),
  } as unknown as ExecutionContext;
}

class TestController {}

test('Bearer service JWT guard verifies issuer, audience, expiry, signature and maps sub to req.user.id', () => {
  const request: AuthenticatedRequest = { headers: { authorization: `Bearer ${signedToken()}` } };
  const guard = new ServiceJwtAuthGuard(new Reflector(), new ServiceJwtVerifier());

  assert.equal(guard.canActivate(executionContext(request)), true);
  assert.deepEqual(request.user, { id: 'user_001' });
});

test('Bearer service JWT guard rejects absent, expired, invalid-audience, and tampered tokens', () => {
  const guard = new ServiceJwtAuthGuard(new Reflector(), new ServiceJwtVerifier());
  const rejected = (authorization: string | undefined) => {
    const request: AuthenticatedRequest = { headers: { authorization } };
    assert.throws(() => guard.canActivate(executionContext(request)), UnauthorizedException);
  };

  rejected(undefined);
  rejected(`Bearer ${signedToken({ exp: Math.floor(Date.now() / 1_000) - 1 })}`);
  rejected(`Bearer ${signedToken({ aud: 'another-api' })}`);
  rejected(`${`Bearer ${signedToken()}`}x`);
});

class ProviderCallbackController {
  @PublicRoute()
  callback(): void {}
}

test('explicit public routes bypass the service JWT guard for provider callbacks', () => {
  const request: AuthenticatedRequest = { headers: {} };
  const guard = new ServiceJwtAuthGuard(new Reflector(), new ServiceJwtVerifier());
  const handler = ProviderCallbackController.prototype.callback;
  const context = {
    getHandler: () => handler,
    getClass: () => ProviderCallbackController,
    switchToHttp: () => ({ getRequest: <T>() => request as T }),
  } as unknown as ExecutionContext;

  assert.equal(guard.canActivate(context), true);
  assert.equal(request.user, undefined);
});
