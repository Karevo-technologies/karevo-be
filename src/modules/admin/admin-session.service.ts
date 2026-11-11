import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AdminSession } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { RefreshSessionStore, SessionDelegate } from '../../common/sessions/refresh-session-store';
import { Env } from '../../config/env';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientContext, describeDevice } from '../auth/device';
import { ADMIN_SESSION, AdminAccessTokenPayload, RequestAdmin } from './admin-context';

/**
 * Admin sessions and tokens. Admin tokens are signed with JWT_ADMIN_SECRET, a
 * different secret from patient and organisation tokens (admin spec §2.1).
 */
@Injectable()
export class AdminSessionService {
  readonly store: RefreshSessionStore<AdminSession>;
  private readonly accessTtl: number;
  private readonly secret: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    crypto: CryptoService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtl = config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    this.secret = config.get('JWT_ADMIN_SECRET', { infer: true });
    this.store = new RefreshSessionStore<AdminSession>(
      crypto,
      () => this.prisma.adminSession as unknown as SessionDelegate<AdminSession>,
      'adminId',
      ADMIN_SESSION.refreshTtlMs,
      ADMIN_SESSION.idleMs,
    );
  }

  create(adminId: string, client: ClientContext) {
    return this.store.create(adminId, { ...client, deviceName: describeDevice(client.userAgent).deviceName });
  }

  async issueAccessToken(adminId: string, sessionId: string) {
    const payload: AdminAccessTokenPayload = { sub: adminId, sid: sessionId, typ: 'admin_access' };
    const accessToken = await this.jwt.signAsync(payload, { secret: this.secret, expiresIn: this.accessTtl });
    return { accessToken, expiresIn: this.accessTtl };
  }

  sign(payload: object, expiresInSeconds: number) {
    return this.jwt.signAsync(payload, { secret: this.secret, expiresIn: expiresInSeconds });
  }

  verify<T extends object>(token: string): Promise<T> {
    return this.jwt.verifyAsync<T>(token, { secret: this.secret });
  }

  /** Every request: live session and an active admin. The role is read fresh, so changes apply at once. */
  async validateForRequest(sessionId: string, adminId: string): Promise<RequestAdmin> {
    const session = await this.prisma.adminSession.findUnique({
      where: { id: sessionId },
      include: { admin: { select: { status: true, role: true } } },
    });
    await this.store.assertUsable(session, adminId);
    if (session!.admin.status !== 'active') throw AppException.unauthenticated();
    return { id: adminId, sessionId, role: session!.admin.role };
  }
}
