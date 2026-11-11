import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { Env } from '../../config/env';
import { CryptoService } from '../../crypto/crypto.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ORG_SESSION } from './org-context';

type Db = PrismaService | Prisma.TransactionClient;

/** Issues staff invite links. Used by organisation admins and by Karevo admins. */
@Injectable()
export class OrgInvitesService {
  private readonly dashboardUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly mail: MailService,
    config: ConfigService<Env, true>,
  ) {
    this.dashboardUrl = config.get('ORG_DASHBOARD_URL', { infer: true }).replace(/\/+$/, '');
  }

  /**
   * Creates a fresh invite for an `invited` member. Only the newest link
   * works: issuing one cancels the member's earlier unused links.
   * Returns the invite URL; only its SHA-256 is stored.
   */
  async issue(member: { id: string; name: string; email: string }, orgName: string, db: Db = this.prisma): Promise<string> {
    const token = this.crypto.randomToken();
    const now = new Date();
    await db.orgInvite.updateMany({ where: { memberId: member.id, usedAt: null }, data: { usedAt: now } });
    await db.orgInvite.create({
      data: {
        memberId: member.id,
        tokenHash: this.crypto.sha256(token),
        expiresAt: new Date(now.getTime() + ORG_SESSION.inviteTtlMs),
      },
    });
    const inviteUrl = `${this.dashboardUrl}/auth/accept-invite?token=${encodeURIComponent(token)}`;
    await this.mail.sendOrgInvite({ to: member.email, name: member.name, orgName, inviteUrl });
    return inviteUrl;
  }
}
