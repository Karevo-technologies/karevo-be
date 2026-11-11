import { Injectable } from '@nestjs/common';
import { ActivityService } from '../../activity/activity.service';
import { AppException } from '../../common/errors/app.exception';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientContext } from '../auth/device';
import { PasswordPolicyService } from '../auth/password-policy';
import { AcceptInviteDto, OrgAuthResponse, OrgLoginDto } from './dto/org.dto';
import { toMemberView, toOrgProfileView } from './org.presenters';
import { OrgSessionService } from './org-session.service';

const BLOCKED_ORG_STATUSES = ['suspended', 'rejected'];

/** Organisation staff sign-in. Accounts are invite-only; there is no self-registration. */
@Injectable()
export class OrgAuthService {
  // Verified against when the email is unknown, so response time does not reveal which emails exist.
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly sessions: OrgSessionService,
    private readonly activity: ActivityService,
    private readonly passwordPolicy: PasswordPolicyService,
  ) {}

  /** Sets the invitee's name and password, activates the account and signs them in. */
  async acceptInvite(dto: AcceptInviteDto, client: ClientContext): Promise<{ body: OrgAuthResponse; refreshToken: string }> {
    if (await this.passwordPolicy.isBreached(dto.password)) {
      throw AppException.validation({ password: 'This password is too common. Choose another.' });
    }
    const invalid = () => AppException.validation({ token: 'This invite link is invalid or has expired.' });

    const invite = await this.prisma.orgInvite.findUnique({
      where: { tokenHash: this.crypto.sha256(dto.token) },
      include: { member: { include: { org: true } } },
    });
    const now = new Date();
    if (!invite || invite.usedAt || invite.expiresAt <= now || invite.member.status !== 'invited') throw invalid();
    if (BLOCKED_ORG_STATUSES.includes(invite.member.org.status)) throw invalid();

    const passwordHash = await this.crypto.hashSecret(dto.password);
    const result = await this.prisma.$transaction(async (tx) => {
      // Conditional update: two concurrent accepts of one link succeed at most once.
      const used = await tx.orgInvite.updateMany({ where: { id: invite.id, usedAt: null }, data: { usedAt: now } });
      if (used.count !== 1) throw invalid();

      const member = await tx.orgMember.update({
        where: { id: invite.memberId },
        data: { name: dto.name, passwordHash, status: 'active', activatedAt: now },
      });
      await this.activity.recordOrg(member.orgId, member.id, 'Member Joined', `${member.name} accepted their invite`, 'info', tx);
      return member;
    });

    const { session, refreshToken } = await this.sessions.create(result.id, client);
    const tokens = await this.sessions.issueAccessToken(result.id, session.id);
    return {
      body: { ...tokens, me: { member: toMemberView(result), org: toOrgProfileView(invite.member.org) } },
      refreshToken,
    };
  }

  async login(dto: OrgLoginDto, client: ClientContext): Promise<{ body: OrgAuthResponse; refreshToken: string }> {
    const member = await this.prisma.orgMember.findUnique({ where: { email: dto.email }, include: { org: true } });
    if (!member?.passwordHash) {
      await this.crypto.verifySecret(await this.getDummyHash(), dto.password);
      throw AppException.invalidCredentials();
    }

    const ok = await this.crypto.verifySecret(member.passwordHash, dto.password);
    if (!ok || member.status !== 'active' || BLOCKED_ORG_STATUSES.includes(member.org.status)) {
      throw AppException.invalidCredentials();
    }

    const { session, refreshToken } = await this.sessions.create(member.id, client);
    const tokens = await this.sessions.issueAccessToken(member.id, session.id);
    return { body: { ...tokens, me: { member: toMemberView(member), org: toOrgProfileView(member.org) } }, refreshToken };
  }

  async refresh(refreshToken: string) {
    const { session, refreshToken: next } = await this.sessions.store.rotate(refreshToken);
    // A member removed, or an organisation suspended, since the last refresh cannot continue.
    await this.sessions.validateForRequest(session.id, session.memberId);
    const tokens = await this.sessions.issueAccessToken(session.memberId, session.id);
    return { body: tokens, refreshToken: next };
  }

  async logout(refreshToken: string | undefined) {
    if (refreshToken) await this.sessions.store.revokeByToken(refreshToken);
  }

  private getDummyHash() {
    this.dummyHash ??= this.crypto.hashSecret(this.crypto.randomToken());
    return this.dummyHash;
  }
}
