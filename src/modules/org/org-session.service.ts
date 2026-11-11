import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OrgSession } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { RefreshSessionStore, SessionDelegate } from '../../common/sessions/refresh-session-store';
import { Env } from '../../config/env';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientContext, describeDevice } from '../auth/device';
import { ORG_SESSION, OrgAccessTokenPayload, RequestOrgMember } from './org-context';

@Injectable()
export class OrgSessionService {
  readonly store: RefreshSessionStore<OrgSession>;
  private readonly accessTtl: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    crypto: CryptoService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtl = config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
    this.store = new RefreshSessionStore<OrgSession>(
      crypto,
      () => this.prisma.orgSession as unknown as SessionDelegate<OrgSession>,
      'memberId',
      ORG_SESSION.refreshTtlMs,
      ORG_SESSION.idleMs,
    );
  }

  create(memberId: string, client: ClientContext) {
    return this.store.create(memberId, { ...client, deviceName: describeDevice(client.userAgent).deviceName });
  }

  async issueAccessToken(memberId: string, sessionId: string) {
    const payload: OrgAccessTokenPayload = { sub: memberId, sid: sessionId, typ: 'org_access' };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: this.accessTtl });
    return { accessToken, expiresIn: this.accessTtl };
  }

  /**
   * Every request: the session must be live, the member active, and the
   * organisation neither suspended nor rejected. Suspension therefore cuts
   * access immediately, even before the admin action revokes the sessions.
   */
  async validateForRequest(sessionId: string, memberId: string): Promise<RequestOrgMember> {
    const session = await this.prisma.orgSession.findUnique({
      where: { id: sessionId },
      include: { member: { select: { status: true, role: true, orgId: true, org: { select: { status: true } } } } },
    });
    await this.store.assertUsable(session, memberId);
    const member = session!.member;
    if (member.status !== 'active' || member.org.status === 'suspended' || member.org.status === 'rejected') {
      throw AppException.unauthenticated();
    }
    return { id: memberId, sessionId, orgId: member.orgId, role: member.role, orgStatus: member.org.status };
  }
}
