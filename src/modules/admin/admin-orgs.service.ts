import { Injectable } from '@nestjs/common';
import { Organisation, OrgStatus, Prisma } from '@prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { AppException } from '../../common/errors/app.exception';
import { Page, pageArgs, toPage } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgInvitesService } from '../org/org-invites.service';
import { RequestAdmin } from './admin-context';
import { AdminAuditService } from './admin-audit.service';
import {
  AdminOrgDetailView,
  AdminOrgView,
  CreateOrgDto,
  InviteOrgAdminDto,
  ListOrgsQueryDto,
  OrgTransition,
  ReasonDto,
} from './dto/admin.dto';

/** Which status each transition starts from and moves to. */
const TRANSITIONS: Record<OrgTransition, { from: OrgStatus[]; to: OrgStatus; label: string }> = {
  approve: { from: ['pending', 'rejected'], to: 'verified', label: 'approved' },
  reject: { from: ['pending'], to: 'rejected', label: 'rejected' },
  suspend: { from: ['verified'], to: 'suspended', label: 'suspended' },
  reinstate: { from: ['suspended'], to: 'verified', label: 'reinstated' },
};

type OrgWithCount = Organisation & { _count: { members: number } };

function toAdminOrgView(o: OrgWithCount): AdminOrgView {
  return {
    id: o.id,
    name: o.name,
    kind: o.kind,
    status: o.status,
    statusReason: o.statusReason,
    cacNumber: o.cacNumber,
    email: o.email,
    phone: o.phone,
    authorisedPerson: o.authorisedPerson,
    memberCount: o._count.members,
    createdAt: o.createdAt.toISOString(),
  };
}

const MEMBER_COUNT = { _count: { select: { members: { where: { status: { not: 'removed' as const } } } } } };

/** Organisation onboarding and verification (admin spec §4.2). Roles: super_admin, ops_support. */
@Injectable()
export class AdminOrgsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly invites: OrgInvitesService,
    private readonly activity: ActivityService,
  ) {}

  /** Creates an organisation (status pending) and invites its first admin. */
  async create(admin: RequestAdmin, dto: CreateOrgDto): Promise<{ org: AdminOrgView; inviteUrl: string }> {
    await this.assertEmailFree(dto.firstAdmin.email);
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organisation.create({
        data: {
          name: dto.name,
          kind: dto.kind,
          cacNumber: dto.cacNumber,
          email: dto.email,
          phone: dto.phone,
          authorisedPerson: dto.authorisedPerson,
        },
      });
      const member = await tx.orgMember.create({
        data: { orgId: org.id, name: dto.firstAdmin.name, email: dto.firstAdmin.email, role: 'admin' },
      });
      const inviteUrl = await this.invites.issue(member, org.name, tx);
      await this.audit.log(
        admin.id,
        { action: 'org.create', targetType: 'organisation', targetId: org.id, reasonCode: dto.reasonCode, note: dto.note, metadata: { firstAdminEmail: member.email } },
        tx,
      );
      return { org: toAdminOrgView({ ...org, _count: { members: 1 } }), inviteUrl };
    });
  }

  async list(query: ListOrgsQueryDto): Promise<Page<AdminOrgView>> {
    const where: Prisma.OrganisationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    const rows = await this.prisma.organisation.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: MEMBER_COUNT,
      ...pageArgs(query),
    });
    return toPage(rows, query.limit, toAdminOrgView);
  }

  async get(id: string): Promise<AdminOrgDetailView> {
    const org = await this.prisma.organisation.findUnique({
      where: { id },
      include: { ...MEMBER_COUNT, members: { where: { status: { not: 'removed' } }, orderBy: { createdAt: 'asc' } } },
    });
    if (!org) throw AppException.notFound('Organisation');
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [pendingRequests, activeConsents, recordsIssued, recordAccesses30d] = await Promise.all([
      this.prisma.consentRequest.count({ where: { orgId: id, status: 'pending' } }),
      this.prisma.consentRequest.count({ where: { orgId: id, status: 'active', expiresAt: { gt: new Date() } } }),
      this.prisma.healthRecord.count({ where: { issuedById: id } }),
      this.prisma.recordAccessEvent.count({ where: { orgId: id, accessedAt: { gte: since } } }),
    ]);
    return {
      ...toAdminOrgView(org),
      members: org.members.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
        status: m.status,
        activatedAt: m.activatedAt ? m.activatedAt.toISOString() : null,
      })),
      stats: { pendingRequests, activeConsents, recordsIssued, recordAccesses30d },
    };
  }

  /**
   * Approve, reject, suspend or reinstate. Suspension and rejection also end
   * every staff session, so access stops at once (admin spec §4.5).
   */
  async transition(admin: RequestAdmin, id: string, action: OrgTransition, dto: ReasonDto): Promise<AdminOrgView> {
    const rule = TRANSITIONS[action];
    const org = await this.prisma.$transaction(async (tx) => {
      const current = await tx.organisation.findUnique({ where: { id } });
      if (!current) throw AppException.notFound('Organisation');
      if (!rule.from.includes(current.status)) {
        throw AppException.conflict(`An organisation that is ${current.status} cannot be ${rule.label}.`);
      }
      // Conditional on the status just read, so two admins acting at once cannot both apply.
      const { count } = await tx.organisation.updateMany({
        where: { id, status: current.status },
        data: { status: rule.to, verified: rule.to === 'verified', statusReason: dto.note ?? dto.reasonCode },
      });
      if (count !== 1) throw AppException.conflict('This organisation was changed by someone else. Reload and try again.');

      if (rule.to === 'suspended' || rule.to === 'rejected') {
        await tx.orgSession.updateMany({ where: { member: { orgId: id }, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.audit.log(admin.id, { action: `org.${action}`, targetType: 'organisation', targetId: id, reasonCode: dto.reasonCode, note: dto.note, metadata: { from: current.status, to: rule.to } }, tx);
      await this.activity.recordOrg(id, null, 'Status Changed', `Karevo ${rule.label} this organisation`, 'info', tx);
      return tx.organisation.findUniqueOrThrow({ where: { id }, include: MEMBER_COUNT });
    });
    return toAdminOrgView(org);
  }

  /** Invites another admin for an organisation, e.g. when its only admin has left. */
  async inviteAdmin(admin: RequestAdmin, id: string, dto: InviteOrgAdminDto): Promise<{ inviteUrl: string }> {
    await this.assertEmailFree(dto.email);
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organisation.findUnique({ where: { id } });
      if (!org) throw AppException.notFound('Organisation');
      const member = await tx.orgMember.create({ data: { orgId: id, name: dto.name, email: dto.email, role: 'admin' } });
      const inviteUrl = await this.invites.issue(member, org.name, tx);
      await this.audit.log(admin.id, { action: 'org.invite_admin', targetType: 'organisation', targetId: id, reasonCode: dto.reasonCode, note: dto.note, metadata: { email: dto.email } }, tx);
      return { inviteUrl };
    });
  }

  private async assertEmailFree(email: string) {
    const taken = await this.prisma.orgMember.findUnique({ where: { email }, select: { id: true } });
    if (taken) throw AppException.conflict('Someone with this email already has a Karevo organisation account.');
  }
}
