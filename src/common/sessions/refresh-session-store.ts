import { AppException } from '../errors/app.exception';
import { CryptoService } from '../../crypto/crypto.service';

/** Columns every realm's session table shares (OrgSession, AdminSession). */
export interface StoredSession {
  id: string;
  refreshTokenHash: string;
  deviceName: string;
  lastActiveAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** The slice of a Prisma model delegate the store needs. */
export interface SessionDelegate<T extends StoredSession> {
  create(args: { data: Record<string, unknown> }): Promise<T>;
  findUnique(args: { where: { id: string } }): Promise<T | null>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<T>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
}

export interface SessionClient {
  ip: string | null;
  userAgent: string | null;
  deviceName: string;
}

// lastActiveAt is written at most once a minute per session, not on every request.
const TOUCH_INTERVAL_MS = 60_000;
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Refresh-token sessions for the organisation and admin realms, with the same
 * rules as the patient SessionService (docs/DECISIONS.md D-12, D-13): the
 * token is `<sessionId>.<secret>`, only a SHA-256 of the secret is stored, the
 * secret rotates on every refresh, and replaying an old secret revokes the session.
 */
export class RefreshSessionStore<T extends StoredSession> {
  constructor(
    private readonly crypto: CryptoService,
    private readonly delegate: () => SessionDelegate<T>,
    /** Column holding the owner's id, e.g. "memberId" or "adminId". */
    private readonly ownerKey: string,
    private readonly ttlMs: number,
    private readonly idleMs: number,
  ) {}

  async create(ownerId: string, client: SessionClient): Promise<{ session: T; refreshToken: string }> {
    const secret = this.crypto.randomToken();
    const session = await this.delegate().create({
      data: {
        [this.ownerKey]: ownerId,
        refreshTokenHash: this.crypto.sha256(secret),
        deviceName: client.deviceName,
        ip: client.ip,
        userAgent: client.userAgent?.slice(0, 512) ?? null,
        expiresAt: new Date(Date.now() + this.ttlMs),
      },
    });
    return { session, refreshToken: `${session.id}.${secret}` };
  }

  async rotate(refreshToken: string): Promise<{ session: T; refreshToken: string }> {
    const { sessionId, secret } = this.parse(refreshToken);
    const session = await this.delegate().findUnique({ where: { id: sessionId } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw AppException.unauthenticated();

    if (!this.crypto.safeEqual(session.refreshTokenHash, this.crypto.sha256(secret))) {
      await this.revoke(session.id);
      throw AppException.unauthenticated();
    }
    await this.assertNotIdle(session);

    const nextSecret = this.crypto.randomToken();
    const updated = await this.delegate().update({
      where: { id: session.id },
      data: {
        refreshTokenHash: this.crypto.sha256(nextSecret),
        lastActiveAt: new Date(),
        expiresAt: new Date(Date.now() + this.ttlMs),
      },
    });
    return { session: updated, refreshToken: `${updated.id}.${nextSecret}` };
  }

  /** Revokes the session behind a refresh token. Silently ignores unknown tokens. */
  async revokeByToken(refreshToken: string): Promise<T | null> {
    let parsed: { sessionId: string; secret: string };
    try {
      parsed = this.parse(refreshToken);
    } catch {
      return null;
    }
    const session = await this.delegate().findUnique({ where: { id: parsed.sessionId } });
    if (!session || session.revokedAt) return null;
    if (!this.crypto.safeEqual(session.refreshTokenHash, this.crypto.sha256(parsed.secret))) return null;
    return this.revoke(session.id);
  }

  revoke(sessionId: string): Promise<T> {
    return this.delegate().update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
  }

  revokeAllFor(ownerId: string) {
    return this.delegate().updateMany({
      where: { [this.ownerKey]: ownerId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Called by the realm's guard on every request with the session row already
   * loaded (so the guard can join the owner in the same query).
   */
  async assertUsable(session: T | null, ownerId: string): Promise<T> {
    if (
      !session ||
      (session as unknown as Record<string, unknown>)[this.ownerKey] !== ownerId ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    ) {
      throw AppException.unauthenticated();
    }
    await this.assertNotIdle(session);
    if (Date.now() - session.lastActiveAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.delegate().update({ where: { id: session.id }, data: { lastActiveAt: new Date() } });
    }
    return session;
  }

  private async assertNotIdle(session: T) {
    if (Date.now() - session.lastActiveAt.getTime() > this.idleMs) {
      await this.revoke(session.id);
      throw AppException.unauthenticated('You were signed out after a period of inactivity.');
    }
  }

  private parse(refreshToken: string) {
    const [sessionId, secret, ...rest] = refreshToken.split('.');
    if (!sessionId || !secret || rest.length || !UUID.test(sessionId)) throw AppException.unauthenticated();
    return { sessionId, secret };
  }
}
