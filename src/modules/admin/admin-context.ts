import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AdminRole } from '@prisma/client';

/** What AdminAuthGuard attaches to `req.admin` on every admin request. */
export interface RequestAdmin {
  id: string;
  sessionId: string;
  role: AdminRole;
}

export interface AdminAccessTokenPayload {
  sub: string;
  sid: string;
  typ: 'admin_access';
}

export const ADMIN_ROLES = 'adminRoles';

/**
 * Roles allowed on an admin route (karevo-admin docs §3, lib/rbac.ts).
 * Required: an admin route without it is refused for everyone.
 */
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ADMIN_ROLES, roles);

export const ALL_ADMIN_ROLES: AdminRole[] = ['super_admin', 'compliance_officer', 'ops_support', 'analyst'];

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestAdmin => ctx.switchToHttp().getRequest().admin,
);

const MINUTE = 60_000;

export const ADMIN_SESSION = {
  refreshTtlMs: 12 * 60 * MINUTE,
  /** Admin spec §6: shorter idle timeout than the patient and organisation apps. */
  idleMs: 15 * MINUTE,
  challengeTtlSeconds: 300,
};

/**
 * Reason codes for admin actions. Admin spec §6: every state change needs a
 * queryable reason code; `other` must come with a note.
 */
export const REASON_CODES = [
  'documents_verified',
  'documents_invalid',
  'identity_confirmed',
  'identity_mismatch',
  'duplicate_account',
  'fraud_suspected',
  'policy_violation',
  'org_request',
  'user_request',
  'compliance_review',
  'support_request',
  'other',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];
