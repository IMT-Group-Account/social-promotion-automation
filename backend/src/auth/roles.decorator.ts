import { SetMetadata } from '@nestjs/common';
export type PromotionRole='editor'|'publisher'|'admin';
export const REQUIRED_ROLES='requiredPromotionRoles';
export const RequireRoles=(...roles:PromotionRole[])=>SetMetadata(REQUIRED_ROLES,roles);
