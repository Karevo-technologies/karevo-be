import { ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * The three kinds of account. Each has its own tables, sessions, token `typ`
 * and global guard, and a route belongs to exactly one realm (patient by default).
 * See docs/ORG_AND_ADMIN_PLAN.md §3.
 */
export type Realm = 'user' | 'org' | 'admin';

export const REALM = 'authRealm';

/** Puts a controller (or route) in the organisation or admin realm. */
export const UseRealm = (realm: Realm) => SetMetadata(REALM, realm);

export function routeRealm(reflector: Reflector, ctx: ExecutionContext): Realm {
  return reflector.getAllAndOverride<Realm>(REALM, [ctx.getHandler(), ctx.getClass()]) ?? 'user';
}

/** Splits `Authorization: Bearer <token>`; returns null for anything else. */
export function bearerToken(header: string | undefined): string | null {
  const [scheme, token] = (header ?? '').split(' ');
  return scheme === 'Bearer' && token ? token : null;
}
