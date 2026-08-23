import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './authenticated-request';
import { IS_PUBLIC_ROUTE } from './public-route.decorator';
import { ServiceJwtVerifier } from './service-jwt-verifier.service';

@Injectable()
export class ServiceJwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: ServiceJwtVerifier,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (typeof authorization !== 'string') throw new UnauthorizedException('Authorization: Bearer <token> is required.');
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization);
    if (!match) throw new UnauthorizedException('Authorization: Bearer <token> is required.');

    request.user = this.verifier.verify(match[1]);
    return true;
  }
}
