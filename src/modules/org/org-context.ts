import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { OrgRole, OrgStatus } from '@prisma/client';

/** What OrgAuthGuard attaches to `req.orgMember` on every organisation request. */
export interface RequestOrgMember {
  id: string;
  sessionId: string;
  orgId: string;
  role: OrgRole;
  orgStatus: OrgStatus;
}

export interface OrgAccessTokenPayload {
  sub: string;
  sid: string;
  typ: 'org_access';
}

export const ORG_ROLES = 'orgRoles';
export const REQUIRES_VERIFIED_ORG = 'requiresVerifiedOrg';

/** Route is limited to these organisation roles, else 403 FORBIDDEN. */
export const OrgRoles = (...roles: OrgRole[]) => SetMetadata(ORG_ROLES, roles);

/** Route needs the organisation approved by Karevo, else 403 ORG_NOT_VERIFIED. */
export const RequireVerifiedOrg = () => SetMetadata(REQUIRES_VERIFIED_ORG, true);

export const CurrentMember = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestOrgMember => ctx.switchToHttp().getRequest().orgMember,
);

const HOUR = 60 * 60 * 1000;

export const ORG_SESSION = {
  refreshTtlMs: 7 * 24 * HOUR,
  idleMs: HOUR,
  inviteTtlMs: 7 * 24 * HOUR,
  /** How long a redeemed visit QR gives read access (plan Q2). */
  visitGrantMs: 2 * HOUR,
};
