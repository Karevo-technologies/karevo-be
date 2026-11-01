import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { RequestUser } from './request-user';

export const IS_PUBLIC = 'isPublic';
export const REQUIRES_VERIFIED_NIN = 'requiresVerifiedNin';

/** Skips the global JwtAuthGuard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route needs `user.ninStatus === 'verified'`, else 403 NIN_NOT_VERIFIED. */
export const RequireVerifiedNin = () => SetMetadata(REQUIRES_VERIFIED_NIN, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => ctx.switchToHttp().getRequest().user,
);
