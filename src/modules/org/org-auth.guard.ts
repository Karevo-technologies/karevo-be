import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { OrgRole } from '@prisma/client';
import { Request } from 'express';
import { IS_PUBLIC } from '../../common/auth/decorators';
import { bearerToken, routeRealm } from '../../common/auth/realm';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { ORG_ROLES, OrgAccessTokenPayload, REQUIRES_VERIFIED_ORG } from './org-context';
import { OrgSessionService } from './org-session.service';

/**
 * Global guard for the organisation realm (@UseRealm('org')). Accepts only
 * `org_access` tokens, so patient and admin tokens are refused here.
 */
@Injectable()
export class OrgAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly sessions: OrgSessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (routeRealm(this.reflector, ctx) !== 'org') return true;

    const req = ctx.switchToHttp().getRequest<Request & { orgMember?: unknown }>();
    const token = bearerToken(req.get('authorization'));
    if (!token) throw AppException.unauthenticated();

    let payload: OrgAccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<OrgAccessTokenPayload>(token);
    } catch (err) {
      if ((err as Error).name === 'TokenExpiredError') throw AppException.tokenExpired();
      throw AppException.unauthenticated();
    }
    if (payload.typ !== 'org_access') throw AppException.unauthenticated();

    const member = await this.sessions.validateForRequest(payload.sid, payload.sub);
    req.orgMember = member;

    const roles = this.reflector.getAllAndOverride<OrgRole[] | undefined>(ORG_ROLES, targets);
    if (roles && !roles.includes(member.role)) {
      throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'Only organisation admins can do this.');
    }
    if (this.reflector.getAllAndOverride<boolean>(REQUIRES_VERIFIED_ORG, targets) && member.orgStatus !== 'verified') {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.ORG_NOT_VERIFIED,
        'Your organisation must be approved by Karevo before you can do this.',
      );
    }
    return true;
  }
}
