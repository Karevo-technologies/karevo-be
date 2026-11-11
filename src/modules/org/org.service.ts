import { HttpStatus, Injectable } from '@nestjs/common';
import { ActivityService } from '../../activity/activity.service';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { CursorQueryDto, Page, pageArgs, toPage } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import {
  InviteMemberDto,
  InviteResult,
  MemberView,
  OrgActivityView,
  OrgMeView,
  OrgProfileView,
  OrgSummaryView,
  UpdateOrgProfileDto,
} from './dto/org.dto';
import { RequestOrgMember } from './org-context';
import { OrgInvitesService } from './org-invites.service';
import { toMemberView, toOrgProfileView } from './org.presenters';
import { OrgSessionService } from './org-session.service';

/** The organisation's own account: profile, team, summary and activity. */
@Injectable()
export class OrgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly invites: OrgInvitesService,
    private readonly sessions: OrgSessionService,
  ) {}

  async getMe(me: RequestOrgMember): Promise<OrgMeView> {
    const member = await this.prisma.orgMember.findUnique({ where: { id: me.id }, include: { org: true } });
    if (!member) throw AppException.notFound('Member');
    return { member: toMemberView(member), org: toOrgProfileView(member.org) };
  }

  async getProfile(me: RequestOrgMember): Promise<OrgProfileView> {
    const org = await this.prisma.organisation.findUnique({ where: { id: me.orgId } });
    if (!org) throw AppException.notFound('Organisation');
    return toOrgProfileView(org);
  }

  async updateProfile(me: RequestOrgMember, dto: UpdateOrgProfileDto): Promise<OrgProfileView> {
    const org = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.organisation.update({ where: { id: me.orgId }, data: { ...dto } });
      await this.activity.recordOrg(me.orgId, me.id, 'Profile Updated', 'Organisation details were updated', 'info', tx);
      return updated;
    });
    return toOrgProfileView(org);
  }

  async listMembers(me: RequestOrgMember): Promise<MemberView[]> {
    const rows = await this.prisma.orgMember.findMany({
      where: { orgId: me.orgId, status: { not: 'removed' } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toMemberView);
  }

  async inviteMember(me: RequestOrgMember, dto: InviteMemberDto): Promise<InviteResult> {
    const existing = await this.prisma.orgMember.findUnique({ where: { email: dto.email } });
    // Emails are global logins, so an address in use anywhere (other than a member this org removed) is taken.
    if (existing && (existing.status !== 'removed' || existing.orgId !== me.orgId)) {
      throw AppException.conflict('Someone with this email already has a Karevo organisation account.');
    }

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organisation.findUniqueOrThrow({ where: { id: me.orgId } });
      // A removed member of this organisation can be invited again: reuse the row.
      const member = existing
        ? await tx.orgMember.update({
            where: { id: existing.id },
            data: { name: dto.name, role: dto.role, status: 'invited', passwordHash: null, removedAt: null, activatedAt: null, invitedById: me.id },
          })
        : await tx.orgMember.create({
            data: { orgId: me.orgId, name: dto.name, email: dto.email, role: dto.role, invitedById: me.id },
          });
      const inviteUrl = await this.invites.issue(member, org.name, tx);
      await this.activity.recordOrg(me.orgId, me.id, 'Member Invited', `${dto.name} (${dto.email}) was invited as ${dto.role}`, 'info', tx);
      return { member: toMemberView(member), inviteUrl };
    });
  }

  async resendInvite(me: RequestOrgMember, memberId: string): Promise<InviteResult> {
    return this.prisma.$transaction(async (tx) => {
      const member = await tx.orgMember.findFirst({ where: { id: memberId, orgId: me.orgId }, include: { org: true } });
      if (!member) throw AppException.notFound('Member');
      if (member.status !== 'invited') throw AppException.conflict('This person has already accepted their invite.');
      const inviteUrl = await this.invites.issue(member, member.org.name, tx);
      return { member: toMemberView(member), inviteUrl };
    });
  }

  async removeMember(me: RequestOrgMember, memberId: string): Promise<void> {
    if (memberId === me.id) {
      throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'You cannot remove yourself.');
    }
    await this.prisma.$transaction(async (tx) => {
      const member = await tx.orgMember.findFirst({ where: { id: memberId, orgId: me.orgId, status: { not: 'removed' } } });
      if (!member) throw AppException.notFound('Member');
      if (member.role === 'admin' && member.status === 'active') {
        const admins = await tx.orgMember.count({ where: { orgId: me.orgId, role: 'admin', status: 'active' } });
        if (admins <= 1) throw AppException.conflict('An organisation must keep at least one admin.');
      }
      await tx.orgMember.update({ where: { id: memberId }, data: { status: 'removed', removedAt: new Date() } });
      await tx.orgInvite.updateMany({ where: { memberId, usedAt: null }, data: { usedAt: new Date() } });
      await this.activity.recordOrg(me.orgId, me.id, 'Member Removed', `${member.name} was removed`, 'info', tx);
    });
    await this.sessions.store.revokeAllFor(memberId);
  }

  async getSummary(me: RequestOrgMember): Promise<OrgSummaryView> {
    const now = new Date();
    const [pendingRequests, activeConsents, declinedRequests, recordsUploaded, activeVisits] = await Promise.all([
      this.prisma.consentRequest.count({ where: { orgId: me.orgId, status: 'pending' } }),
      this.prisma.consentRequest.count({ where: { orgId: me.orgId, status: 'active', expiresAt: { gt: now } } }),
      this.prisma.consentRequest.count({ where: { orgId: me.orgId, status: 'declined' } }),
      this.prisma.healthRecord.count({ where: { issuedById: me.orgId } }),
      this.prisma.visitGrant.count({ where: { orgId: me.orgId, revokedAt: null, expiresAt: { gt: now } } }),
    ]);
    return { pendingRequests, activeConsents, declinedRequests, recordsUploaded, activeVisits };
  }

  async listActivity(me: RequestOrgMember, query: CursorQueryDto): Promise<Page<OrgActivityView>> {
    const rows = await this.prisma.orgActivityEvent.findMany({
      where: { orgId: me.orgId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      include: { member: { select: { id: true, name: true } } },
      ...pageArgs(query),
    });
    return toPage(rows, query.limit, (r) => ({
      id: r.id,
      action: r.action,
      description: r.description,
      status: r.status,
      member: r.member,
      occurredAt: r.occurredAt.toISOString(),
    }));
  }
}
