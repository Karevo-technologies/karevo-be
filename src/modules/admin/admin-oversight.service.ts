import { Injectable } from '@nestjs/common';
import { OrgStatus, Prisma } from '@prisma/client';
import { Page, pageArgs, toPage } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AdminActionsQueryDto,
  AdminActionView,
  AdminConsentView,
  ListAdminConsentsQueryDto,
  OverviewView,
  RecordAccessQueryDto,
  RecordAccessView,
} from './dto/admin.dto';

const OVERVIEW_TTL_MS = 60_000;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Read-only views for compliance and reporting (admin spec §4.1, §4.4).
 * Patients appear by Karevo ID only, never by name.
 */
@Injectable()
export class AdminOversightService {
  private overviewCache?: { at: number; value: OverviewView };

  constructor(private readonly prisma: PrismaService) {}

  async consents(query: ListAdminConsentsQueryDto): Promise<Page<AdminConsentView>> {
    const where: Prisma.ConsentRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.orgId ? { orgId: query.orgId } : {}),
      ...(query.karevoId ? { user: { karevoId: query.karevoId.toUpperCase() } } : {}),
    };
    const rows = await this.prisma.consentRequest.findMany({
      where,
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      include: { user: { select: { karevoId: true } }, org: { select: { id: true, name: true } } },
      ...pageArgs(query),
    });
    return toPage(rows, query.limit, (c) => ({
      id: c.id,
      patient: { karevoId: c.user.karevoId },
      org: c.org,
      scope: c.scope,
      purpose: c.purpose,
      status: c.status,
      requestedAt: c.requestedAt.toISOString(),
      resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
      expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
      note: c.note,
    }));
  }

  async recordAccess(query: RecordAccessQueryDto): Promise<Page<RecordAccessView>> {
    const where: Prisma.RecordAccessEventWhereInput = {
      ...(query.karevoId ? { user: { karevoId: query.karevoId.toUpperCase() } } : {}),
      ...(query.orgId ? { orgId: query.orgId } : {}),
      ...(query.via ? { via: query.via } : {}),
      ...(query.from || query.to
        ? { accessedAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } }
        : {}),
    };
    const rows = await this.prisma.recordAccessEvent.findMany({
      where,
      orderBy: [{ accessedAt: 'desc' }, { id: 'desc' }],
      include: {
        user: { select: { karevoId: true } },
        record: { select: { id: true, type: true } },
        org: { select: { id: true, name: true } },
        member: { select: { id: true, name: true } },
        admin: { select: { id: true, name: true } },
      },
      ...pageArgs(query),
    });
    return toPage(rows, query.limit, (e) => ({
      id: e.id,
      patient: { karevoId: e.user.karevoId },
      record: e.record,
      org: e.org,
      member: e.member,
      admin: e.admin,
      via: e.via,
      consentId: e.consentId,
      visitGrantId: e.visitGrantId,
      reasonCode: e.reasonCode,
      accessedAt: e.accessedAt.toISOString(),
    }));
  }

  async adminActions(query: AdminActionsQueryDto): Promise<Page<AdminActionView>> {
    const where: Prisma.AdminActionLogWhereInput = {
      ...(query.adminId ? { adminId: query.adminId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
    };
    const rows = await this.prisma.adminActionLog.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      include: { admin: { select: { id: true, name: true, role: true } } },
      ...pageArgs(query),
    });
    return toPage(rows, query.limit, (a) => ({
      id: a.id,
      admin: a.admin,
      action: a.action,
      targetType: a.targetType,
      targetId: a.targetId,
      reasonCode: a.reasonCode,
      note: a.note,
      occurredAt: a.occurredAt.toISOString(),
    }));
  }

  /** Aggregates only, cached for a minute (admin spec §4.1: no live table scans on every load). */
  async overview(): Promise<OverviewView> {
    if (this.overviewCache && Date.now() - this.overviewCache.at < OVERVIEW_TTL_MS) return this.overviewCache.value;

    const now = Date.now();
    const [orgGroups, activeOrgMembers, patients, ninVerified, records, pending, active, last7d, last30d] = await Promise.all([
      this.prisma.organisation.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.orgMember.count({ where: { status: 'active' } }),
      this.prisma.user.count({ where: { deactivatedAt: null } }),
      this.prisma.user.count({ where: { deactivatedAt: null, ninStatus: 'verified' } }),
      this.prisma.healthRecord.count(),
      this.prisma.consentRequest.count({ where: { status: 'pending' } }),
      this.prisma.consentRequest.count({ where: { status: 'active', expiresAt: { gt: new Date(now) } } }),
      this.prisma.recordAccessEvent.count({ where: { accessedAt: { gte: new Date(now - 7 * DAY) } } }),
      this.prisma.recordAccessEvent.count({ where: { accessedAt: { gte: new Date(now - 30 * DAY) } } }),
    ]);

    const orgs = Object.fromEntries(Object.values(OrgStatus).map((s) => [s, 0])) as Record<OrgStatus, number>;
    for (const g of orgGroups) orgs[g.status] = g._count._all;

    const value: OverviewView = {
      orgs,
      activeOrgMembers,
      patients: { total: patients, ninVerified },
      records,
      consents: { pending, active },
      recordAccesses: { last7d, last30d },
      generatedAt: new Date(now).toISOString(),
    };
    this.overviewCache = { at: now, value };
    return value;
  }
}
