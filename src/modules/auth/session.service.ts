import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Session } from '@prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AppException } from '../../common/errors/app.exception';
import { AccessTokenPayload, RequestUser } from '../../common/auth/request-user';
import { Env } from '../../config/env';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessTokenResponse } from './dto/auth.dto';
import { ClientContext, describeDevice } from './device';

// lastActiveAt is written at most once a minute per session, not on every request.
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Sessions are refresh-token families (spec: "Each refresh token is one row in
 * sessions"). The refresh token is `<sessionId>.<secret>`; only a SHA-256 of
 * the secret is stored, and it changes on every refresh.
 */
@Injectable()
export class SessionService {
  private readonly accessTtl: number;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly crypto: CryptoService,
    private readonly activity: ActivityService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtl = config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    this.refreshTtlDays = config.get('REFRESH_TTL_DAYS', { infer: true });
  }

  get refreshTtlInDays() {
    return this.refreshTtlDays;
  }

  async create(
    userId: string,
    client: ClientContext,
    db: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<{ session: Session; refreshToken: string }> {
    const secret = this.crypto.randomToken();
    const { deviceName, detail } = describeDevice(client.userAgent);
    const session = await db.session.create({
      data: {
        userId,
        refreshTokenHash: this.crypto.sha256(secret),
        deviceName,
        detail,
        // TODO(auth owner): IP-to-city lookup (e.g. a local GeoLite2 database).
        location: null,
        ip: client.ip,
        userAgent: client.userAgent?.slice(0, 512) ?? null,
        expiresAt: this.refreshExpiry(),
      },
    });
    return { session, refreshToken: `${session.id}.${secret}` };
  }

  async issueAccessToken(userId: string, sessionId: string): Promise<AccessTokenResponse> {
    const payload: AccessTokenPayload = { sub: userId, sid: sessionId, typ: 'access' };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.accessTtl });
    return { accessToken, expiresIn: this.accessTtl };
  }

  /**
   * Validates and rotates a refresh token. A valid session id with the wrong
   * secret means an old token was replayed, so the whole session is revoked.
   */
  async rotate(refreshToken: string): Promise<{ session: Session; refreshToken: string }> {
    const { sessionId, secret } = this.parse(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: { select: { deactivatedAt: true, preferences: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.deactivatedAt) {
      throw AppException.unauthenticated();
    }

    if (!this.crypto.safeEqual(session.refreshTokenHash, this.crypto.sha256(secret))) {
      await this.revoke(session.id);
      await this.activity.record(session.userId, 'auth', 'Session ended: refresh token reuse detected', {
        device: session.deviceName,
        location: session.location,
      });
      throw AppException.unauthenticated();
    }

    await this.assertNotIdle(session, session.user.preferences?.autoSignOutMinutes);

    const nextSecret = this.crypto.randomToken();
    const updated = await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: this.crypto.sha256(nextSecret),
        lastActiveAt: new Date(),
        expiresAt: this.refreshExpiry(),
      },
    });
    return { session: updated, refreshToken: `${updated.id}.${nextSecret}` };
  }

  /** Revokes the session behind a refresh token. Silently ignores unknown tokens. */
  async revokeByToken(refreshToken: string): Promise<Session | null> {
    let parsed: { sessionId: string; secret: string };
    try {
      parsed = this.parse(refreshToken);
    } catch {
      return null;
    }
    const session = await this.prisma.session.findUnique({ where: { id: parsed.sessionId } });
    if (!session || session.revokedAt) return null;
    if (!this.crypto.safeEqual(session.refreshTokenHash, this.crypto.sha256(parsed.secret))) return null;
    return this.revoke(session.id);
  }

  revoke(sessionId: string) {
    return this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  }

  /**
   * Called by JwtAuthGuard on every authenticated request, so removing a
   * device or signing out other sessions takes effect immediately rather than
   * when the access token expires.
   */
  async validateForRequest(sessionId: string, userId: string): Promise<RequestUser> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { user: { select: { ninStatus: true, deactivatedAt: true, preferences: true } } },
    });
    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.deactivatedAt
    ) {
      throw AppException.unauthenticated();
    }

    await this.assertNotIdle(session, session.user.preferences?.autoSignOutMinutes);

    if (Date.now() - session.lastActiveAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastActiveAt: new Date() } });
    }
    return { id: userId, sessionId, ninStatus: session.user.ninStatus };
  }

  /** Server-side half of Settings > Auto sign-out. 0 or unset means no idle limit. */
  private async assertNotIdle(session: Session, autoSignOutMinutes?: number) {
    if (!autoSignOutMinutes) return;
    const idleMs = Date.now() - session.lastActiveAt.getTime();
    if (idleMs > autoSignOutMinutes * 60_000) {
      await this.revoke(session.id);
      throw AppException.unauthenticated('You were signed out after a period of inactivity.');
    }
  }

  private parse(refreshToken: string) {
    const [sessionId, secret, ...rest] = refreshToken.split('.');
    const uuid = /^[0-9a-f-]{36}$/i;
    if (!sessionId || !secret || rest.length || !uuid.test(sessionId)) {
      throw AppException.unauthenticated();
    }
    return { sessionId, secret };
  }

  private refreshExpiry() {
    return new Date(Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000);
  }
}
