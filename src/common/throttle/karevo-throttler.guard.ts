import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Keys limits by IP, and by IP + email on the login route, so one attacker
 * cannot lock a user out from elsewhere (docs/DECISIONS.md, D-09).
 * Uses in-memory storage: switch to a Redis storage before running more than one instance.
 */
@Injectable()
export class KarevoThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    const ip: string = req.ip ?? 'unknown';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const isLogin = typeof req.path === 'string' && req.path.endsWith('/auth/login');
    return isLogin && email ? `${ip}:${email}` : ip;
  }
}
