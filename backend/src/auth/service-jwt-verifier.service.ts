import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthenticatedUser } from './authenticated-request';

interface ServiceJwtHeader {
  alg?: unknown;
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
  audience: string;
  issuer: string;
  secret: Buffer;
}

const MAX_JWT_SEGMENT_LENGTH = 8_192;

@Injectable()
export class ServiceJwtVerifier {
  private readonly configuration = this.loadConfiguration();

  verify(token: string): AuthenticatedUser {
    const [encodedHeader, encodedPayload, encodedSignature, ...extra] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature || extra.length > 0) this.invalidToken();
    if (![encodedHeader, encodedPayload, encodedSignature].every((segment) => this.isBase64UrlSegment(segment))) this.invalidToken();

    const header = this.parseJson<ServiceJwtHeader>(encodedHeader);
    if (header.alg !== 'HS256' || (header.typ !== undefined && header.typ !== 'JWT')) this.invalidToken();

    const expectedSignature = createHmac('sha256', this.configuration.secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest();
    const providedSignature = Buffer.from(encodedSignature, 'base64url');
    if (providedSignature.length !== expectedSignature.length || !timingSafeEqual(providedSignature, expectedSignature)) this.invalidToken();

    const payload = this.parseJson<ServiceJwtPayload>(encodedPayload);
    this.validateRegisteredClaims(payload);
    if (typeof payload.sub !== 'string' || payload.sub.trim().length === 0) this.invalidToken();

    return { id: payload.sub };
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

  private loadConfiguration(): JwtConfiguration {
    const secret = process.env.SERVICE_JWT_SECRET;
    const issuer = process.env.SERVICE_JWT_ISSUER;
    const audience = process.env.SERVICE_JWT_AUDIENCE;
    if (!secret || Buffer.byteLength(secret, 'utf8') < 32 || !issuer || !audience) {
      throw new Error('SERVICE_JWT_SECRET (at least 32 bytes), SERVICE_JWT_ISSUER, and SERVICE_JWT_AUDIENCE are required.');
    }
    return { secret: Buffer.from(secret, 'utf8'), issuer, audience };
  }

  private invalidToken(): never {
    throw new UnauthorizedException('A valid service access token is required.');
  }
}
