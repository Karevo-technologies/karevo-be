import { CookieOptions, Request, Response } from 'express';

export const REFRESH_COOKIE = 'karevo_rt';
// Spec: cookie scoped to /api/v1/auth so it is never sent to other routes.
const COOKIE_PATH = '/api/v1/auth';

function options(secure: boolean, maxAgeMs?: number): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'strict', path: COOKIE_PATH, maxAge: maxAgeMs };
}

export function setRefreshCookie(res: Response, token: string, secure: boolean, ttlDays: number) {
  res.cookie(REFRESH_COOKIE, token, options(secure, ttlDays * 24 * 60 * 60 * 1000));
}

export function clearRefreshCookie(res: Response, secure: boolean) {
  res.clearCookie(REFRESH_COOKIE, options(secure));
}

export function readRefreshCookie(req: Request): string | undefined {
  const value = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
