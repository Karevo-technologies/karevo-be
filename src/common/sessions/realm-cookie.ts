import { CookieOptions, Request, Response } from 'express';

/** Each realm's refresh cookie has its own name and is scoped to that realm's auth routes. */
export interface RealmCookie {
  name: string;
  path: string;
}

export const ORG_COOKIE: RealmCookie = { name: 'karevo_org_rt', path: '/api/v1/org/auth' };
export const ADMIN_COOKIE: RealmCookie = { name: 'karevo_admin_rt', path: '/api/v1/admin/auth' };

function options(cookie: RealmCookie, secure: boolean, maxAgeMs?: number): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'strict', path: cookie.path, maxAge: maxAgeMs };
}

export function setRealmCookie(res: Response, cookie: RealmCookie, token: string, secure: boolean, ttlMs: number) {
  res.cookie(cookie.name, token, options(cookie, secure, ttlMs));
}

export function clearRealmCookie(res: Response, cookie: RealmCookie, secure: boolean) {
  res.clearCookie(cookie.name, options(cookie, secure));
}

export function readRealmCookie(req: Request, cookie: RealmCookie): string | undefined {
  const value = req.cookies?.[cookie.name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** CSRF defence for cookie-authenticated endpoints, same rule as the patient realm (D-14). */
export function isTrustedOrigin(req: Request, allowed: string[]): boolean {
  const origin = req.get('origin');
  return !origin || allowed.includes(origin);
}
