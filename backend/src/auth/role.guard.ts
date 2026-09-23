import { CanActivate,ExecutionContext,ForbiddenException,Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from './authenticated-request';
import { REQUIRED_ROLES,type PromotionRole } from './roles.decorator';
@Injectable()
export class RoleGuard implements CanActivate{
  constructor(private readonly reflector:Reflector){}
  canActivate(context:ExecutionContext):boolean{
    if(process.env.SERVICE_RBAC_ENABLED!=='true')return true;
    const required=this.reflector.getAllAndOverride<PromotionRole[]>(REQUIRED_ROLES,[context.getHandler(),context.getClass()]);
    if(!required?.length)return true;
    const roles=context.switchToHttp().getRequest<AuthenticatedRequest>().user?.roles??[];
    if(roles.includes('admin')||required.some(role=>roles.includes(role)))return true;
    throw new ForbiddenException(`One of the required promotion roles is missing: ${required.join(', ')}.`);
  }
}
