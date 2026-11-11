import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from '@prisma/client';
import { Request } from 'express';
import { IS_PUBLIC } from '../../common/auth/decorators';
import { bearerToken, routeRealm } from '../../common/auth/realm';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { ADMIN_ROLES, AdminAccessTokenPayload } from './admin-context';
import { AdminSessionService } from './admin-session.service';

/**
 * Global guard for the admin realm (@UseRealm('admin')). Only `admin_access`
 * tokens signed with JWT_ADMIN_SECRET pass, and roles are enforced here on the
 * server, not just hidden in the UI (admin spec §3). Deny by default: an admin
 * route that declares no @AdminRoles is refused.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: AdminSessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (routeRealm(this.reflector, ctx) !== 'admin') return true;

    const req = ctx.switchToHttp().getRequest<Request & { admin?: unknown }>();
    const token = bearerToken(req.get('authorization'));
    if (!token) throw AppException.unauthenticated();

    let payload: AdminAccessTokenPayload;
    try {
      payload = await this.sessions.verify<AdminAccessTokenPayload>(token);
    } catch (err) {
      if ((err as Error).name === 'TokenExpiredError') throw AppException.tokenExpired();
      throw AppException.unauthenticated();
    }
    if (payload.typ !== 'admin_access') throw AppException.unauthenticated();

    const admin = await this.sessions.validateForRequest(payload.sid, payload.sub);
    req.admin = admin;

    const roles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ADMIN_ROLES, targets);
    if (!roles?.includes(admin.role)) {
      throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'Your role does not allow this.');
    }
    return true;
  }
}
