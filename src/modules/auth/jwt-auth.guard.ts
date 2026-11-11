import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { IS_PUBLIC, REQUIRES_VERIFIED_NIN } from '../../common/auth/decorators';
import { routeRealm } from '../../common/auth/realm';
import { AccessTokenPayload } from '../../common/auth/request-user';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { SessionService } from './session.service';

/**
 * Global guard for the patient realm. Every patient route needs a bearer
 * access token unless marked @Public(); routes marked @RequireVerifiedNin()
 * also need a verified NIN. Organisation and admin routes (@UseRealm) are left
 * to their own guards, which reject patient tokens.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (routeRealm(this.reflector, ctx) !== 'user') return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const [scheme, token] = (req.get('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw AppException.unauthenticated();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch (err) {
      if ((err as Error).name === 'TokenExpiredError') throw AppException.tokenExpired();
      throw AppException.unauthenticated();
    }
    if (payload.typ !== 'access') throw AppException.unauthenticated();

    const user = await this.sessions.validateForRequest(payload.sid, payload.sub);
    (req as Request & { user: unknown }).user = user;

    if (this.reflector.getAllAndOverride<boolean>(REQUIRES_VERIFIED_NIN, targets) && user.ninStatus !== 'verified') {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.NIN_NOT_VERIFIED,
        'Your NIN must be verified before you can do this.',
      );
    }
    return true;
  }
}
