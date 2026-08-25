import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto';
import type { AuthenticatedUser } from './authenticated-request';

type ServiceJwtAlgorithm = 'RS256' | 'ES256';

interface ServiceJwtHeader {
  alg?: unknown;
  kid?: unknown;
  typ?: unknown;
}

interface ServiceJwtPayload {
  sub?: unknown;
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nbf?: unknown;
}

interface JwtConfiguration {
  algorithm: ServiceJwtAlgorithm;
  audience: string;
  issuer: string;
  jwksCacheTtlMs: number;
  jwksUrl: string;
}

interface JwksCache {
  expiresAt: number;
  keys: Map<string, KeyObject>;
  lastUnknownKidRefreshAt: number;
}

const MAX_JWT_SEGMENT_LENGTH = 8_192;
const MAX_JWKS_KEYS = 100;
const DEFAULT_JWKS_CACHE_TTL_MS = 300_000;
const MAX_JWKS_CACHE_TTL_MS = 3_600_000;
const UNKNOWN_KID_REFRESH_COOLDOWN_MS = 30_000;
const JWKS_REQUEST_TIMEOUT_MS = 3_000;

@Injectable()
export class ServiceJwtVerifier {
  private readonly configuration = this.loadConfiguration();
  private jwksCache: JwksCache | undefined;
  private jwksRefresh: Promise<JwksCache> | undefined;

  async verify(token: string): Promise<AuthenticatedUser> {
    const [encodedHeader, encodedPayload, encodedSignature, ...extra] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature || extra.length > 0) this.invalidToken();
    if (![encodedHeader, encodedPayload, encodedSignature].every((segment) => this.isBase64UrlSegment(segment))) this.invalidToken();

    const header = this.parseJson<ServiceJwtHeader>(encodedHeader);
    if (!this.isConfiguredAlgorithm(header.alg) || typeof header.kid !== 'string' || header.kid.length === 0 || header.kid.length > 256
      || (header.typ !== undefined && header.typ !== 'JWT')) this.invalidToken();

    const verificationKey = await this.getVerificationKey(header.kid);
    const signature = Buffer.from(encodedSignature, 'base64url');
    try {
      const valid = header.alg === 'ES256'
        ? verify('sha256', Buffer.from(`${encodedHeader}.${encodedPayload}`), { key: verificationKey, dsaEncoding: 'ieee-p1363' }, signature)
        : verify('sha256', Buffer.from(`${encodedHeader}.${encodedPayload}`), verificationKey, signature);
      if (!valid) this.invalidToken();
    } catch {
      this.invalidToken();
    }

    const payload = this.parseJson<ServiceJwtPayload>(encodedPayload);
    this.validateRegisteredClaims(payload);
    if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0) this.invalidToken();

    return { id: payload.sub };
  }

  private async getVerificationKey(kid: string): Promise<KeyObject> {
    let cache = await this.loadJwks(false);
    let key = cache.keys.get(kid);
    if (key) return key;

    const now = Date.now();
    if (now - cache.lastUnknownKidRefreshAt >= UNKNOWN_KID_REFRESH_COOLDOWN_MS) {
      cache.lastUnknownKidRefreshAt = now;
      cache = await this.loadJwks(true);
      cache.lastUnknownKidRefreshAt = now;
      key = cache.keys.get(kid);
      if (key) return key;
    }

    return this.invalidToken();
  }

  private async loadJwks(forceRefresh: boolean): Promise<JwksCache> {
    if (!forceRefresh && this.jwksCache && this.jwksCache.expiresAt > Date.now()) return this.jwksCache;
    if (this.jwksRefresh) return this.jwksRefresh;

    const refresh = this.fetchJwks();
    this.jwksRefresh = refresh;
    try {
      return await refresh;
    } finally {
      if (this.jwksRefresh === refresh) this.jwksRefresh = undefined;
    }
  }

  private async fetchJwks(): Promise<JwksCache> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), JWKS_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(this.configuration.jwksUrl, {
        headers: { accept: 'application/json' },
        signal: abortController.signal,
      });
      if (!response.ok) return this.invalidToken();
      const cache = this.parseJwks(await response.json());
      this.jwksCache = cache;
      return cache;
    } catch {
      return this.invalidToken();
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseJwks(document: unknown): JwksCache {
    if (!this.isRecord(document) || !Array.isArray(document.keys) || document.keys.length === 0 || document.keys.length > MAX_JWKS_KEYS) this.invalidToken();

    const keys = new Map<string, KeyObject>();
    for (const candidate of document.keys) {
      if (!this.isRecord(candidate) || candidate.use === 'enc' || (candidate.alg !== undefined && candidate.alg !== this.configuration.algorithm) || typeof candidate.kid !== 'string'
        || candidate.kid.length === 0 || candidate.kid.length > 256 || 'd' in candidate) continue;
      if (!this.isExpectedJwkType(candidate)) continue;

      try {
        if (keys.has(candidate.kid)) this.invalidToken();
        keys.set(candidate.kid, createPublicKey({ key: candidate as JsonWebKey, format: 'jwk' }));
      } catch {
        this.invalidToken();
      }
    }

    if (keys.size === 0) this.invalidToken();
    return {
      expiresAt: Date.now() + this.configuration.jwksCacheTtlMs,
      keys,
      lastUnknownKidRefreshAt: 0,
    };
  }

  private isExpectedJwkType(key: Record<string, unknown>): boolean {
    return this.configuration.algorithm === 'RS256'
      ? key.kty === 'RSA'
      : key.kty === 'EC' && key.crv === 'P-256';
  }

  private validateRegisteredClaims(payload: ServiceJwtPayload): void {
    const now = Math.floor(Date.now() / 1_000);
    if (payload.iss !== this.configuration.issuer || !this.hasExpectedAudience(payload.aud)) this.invalidToken();
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= now) this.invalidToken();
    if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf) || payload.nbf > now)) this.invalidToken();
  }

  private hasExpectedAudience(audience: unknown): boolean {
    return typeof audience === 'string'
      ? audience === this.configuration.audience
      : Array.isArray(audience) && audience.includes(this.configuration.audience);
  }

  private parseJson<T>(encodedSegment: string): T {
    try {
      return JSON.parse(Buffer.from(encodedSegment, 'base64url').toString('utf8')) as T;
    } catch {
      return this.invalidToken();
    }
  }

  private isBase64UrlSegment(segment: string): boolean {
    return segment.length <= MAX_JWT_SEGMENT_LENGTH && /^[A-Za-z0-9_-]+$/.test(segment);
  }

  private isConfiguredAlgorithm(algorithm: unknown): algorithm is ServiceJwtAlgorithm {
    return algorithm === this.configuration.algorithm;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private loadConfiguration(): JwtConfiguration {
    if (process.env.SERVICE_JWT_SECRET) {
      throw new Error('SERVICE_JWT_SECRET must not be configured. This API verifies asymmetric JWTs from JWKS only.');
    }
    const issuer = process.env.SERVICE_JWT_ISSUER;
    const audience = process.env.SERVICE_JWT_AUDIENCE;
    const algorithm = process.env.SERVICE_JWT_SIGNING_ALGORITHM;
    const jwksUrl = process.env.SERVICE_JWT_JWKS_URL;
    const jwksCacheTtlMs = this.parseCacheTtl(process.env.SERVICE_JWT_JWKS_CACHE_TTL_MS);
    if (!issuer || !audience || (algorithm !== 'RS256' && algorithm !== 'ES256') || !jwksUrl) {
      throw new Error('SERVICE_JWT_ISSUER, SERVICE_JWT_AUDIENCE, SERVICE_JWT_SIGNING_ALGORITHM (RS256 or ES256), and SERVICE_JWT_JWKS_URL are required.');
    }

    let parsedJwksUrl: URL;
    try {
      parsedJwksUrl = new URL(jwksUrl);
    } catch {
      throw new Error('SERVICE_JWT_JWKS_URL must be a valid HTTPS URL.');
    }
    if (parsedJwksUrl.protocol !== 'https:' || parsedJwksUrl.username || parsedJwksUrl.password || parsedJwksUrl.hash) {
      throw new Error('SERVICE_JWT_JWKS_URL must be a valid HTTPS URL without credentials or a fragment.');
    }

    return { algorithm, audience, issuer, jwksCacheTtlMs, jwksUrl: parsedJwksUrl.toString() };
  }

  private parseCacheTtl(value: string | undefined): number {
    if (value === undefined || value.length === 0) return DEFAULT_JWKS_CACHE_TTL_MS;
    if (!/^\d+$/.test(value)) throw new Error('SERVICE_JWT_JWKS_CACHE_TTL_MS must be an integer in milliseconds.');
    const ttl = Number(value);
    if (!Number.isSafeInteger(ttl) || ttl < 10_000 || ttl > MAX_JWKS_CACHE_TTL_MS) {
      throw new Error(`SERVICE_JWT_JWKS_CACHE_TTL_MS must be between 10000 and ${MAX_JWKS_CACHE_TTL_MS}.`);
    }
    return ttl;
  }

  private invalidToken(): never {
    throw new UnauthorizedException('A valid service access token is required.');
  }
}
