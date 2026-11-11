import { Injectable } from '@nestjs/common';
import { ConsentRequest, Organisation, Prisma } from '@prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { RequestUser } from '../../common/auth/request-user';
import { AppException } from '../../common/errors/app.exception';
import { Page, pageArgs, toPage } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ApproveConsentDto,
  ConsentView,
  ListConsentsQueryDto,
  ResolveConsentDto,
} from './dto/consents.dto';

type ConsentWithOrg = ConsentRequest & {
  org: Pick<Organisation, 'id' | 'name' | 'kind' | 'verified'>;
};

const ORG_SELECT = { id: true, name: true, kind: true, verified: true } as const;

function toConsentView(c: ConsentWithOrg): ConsentView {
  return {
    id: c.id,
    org: c.org,
    scope: c.scope,
    purpose: c.purpose,
    status: c.status,
    requestedDays: c.requestedDays,
    requestedAt: c.requestedAt.toISOString(),
    grantedDays: c.grantedDays,
    grantedAt: c.grantedAt ? c.grantedAt.toISOString() : null,
    expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
    resolvedAt: c.resolvedAt ? c.resolvedAt.toISOString() : null,
    note: c.note,
  };
}

@Injectable()
export class ConsentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async list(me: RequestUser, query: ListConsentsQueryDto): Promise<Page<ConsentView>> {
    const now = new Date();
    let where: Prisma.ConsentRequestWhereInput;
    let orderBy: Prisma.ConsentRequestOrderByWithRelationInput[];

    switch (query.status) {
      case 'pending':
        where = { userId: me.id, status: 'pending' };
        orderBy = [{ requestedAt: 'desc' }, { id: 'desc' }];
        break;
      case 'active':
        where = { userId: me.id, status: 'active', expiresAt: { gt: now } };
        orderBy = [{ expiresAt: 'asc' }, { id: 'desc' }];
        break;
      case 'history':
        where = { userId: me.id, status: { in: ['declined', 'revoked', 'expired'] } };
        orderBy = [{ resolvedAt: 'desc' }, { id: 'desc' }];
        break;
    }

    const rows = (await this.prisma.consentRequest.findMany({
      where,
      orderBy,
      include: { org: { select: ORG_SELECT } },
      ...pageArgs(query),
    })) as ConsentWithOrg[];

    return toPage(rows, query.limit, toConsentView);
  }

  async get(me: RequestUser, id: string): Promise<ConsentView> {
    const consent = (await this.prisma.consentRequest.findFirst({
      where: { id, userId: me.id },
      include: { org: { select: ORG_SELECT } },
    })) as ConsentWithOrg | null;

    if (!consent) throw AppException.notFound('Consent request');
    return toConsentView(consent);
  }

  async approve(me: RequestUser, id: string, dto: ApproveConsentDto): Promise<ConsentView> {
    return this.prisma.$transaction(async (tx) => {
      const consent = await tx.consentRequest.findFirst({
        where: { id, userId: me.id },
        include: { org: { select: ORG_SELECT }, user: { select: { karevoId: true } } },
      });
      if (!consent) throw AppException.notFound('Consent request');
      if (consent.status !== 'pending') {
        throw AppException.conflict('This request is no longer pending.');
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + dto.days * 24 * 60 * 60 * 1000);

      const updateResult = await tx.consentRequest.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: 'active',
          grantedDays: dto.days,
          grantedAt: now,
          expiresAt,
          resolvedAt: now,
        },
      });
      if (updateResult.count === 0) {
        throw AppException.conflict('This request is no longer pending.');
      }

      await this.activity.record(
        me.id,
        'consent',
        `Granted ${consent.org.name} access for ${dto.days} days`,
        { metadata: { consentId: id } },
        tx,
      );
      await this.activity.recordOrg(consent.orgId, null, 'Request Approved', `${consent.user.karevoId} approved access to ${consent.scope.join(', ')} for ${dto.days} days`, 'approved', tx);

      const updated = (await tx.consentRequest.findUniqueOrThrow({
        where: { id },
        include: { org: { select: ORG_SELECT } },
      })) as ConsentWithOrg;

      return toConsentView(updated);
    });
  }

  async decline(me: RequestUser, id: string, dto: ResolveConsentDto): Promise<ConsentView> {
    return this.prisma.$transaction(async (tx) => {
      const consent = await tx.consentRequest.findFirst({
        where: { id, userId: me.id },
        include: { org: { select: ORG_SELECT }, user: { select: { karevoId: true } } },
      });
      if (!consent) throw AppException.notFound('Consent request');
      if (consent.status !== 'pending') {
        throw AppException.conflict('This request is no longer pending.');
      }

      const now = new Date();
      const updateResult = await tx.consentRequest.updateMany({
        where: { id, status: 'pending' },
        data: {
          status: 'declined',
          resolvedAt: now,
          note: dto.note ?? null,
        },
      });
      if (updateResult.count === 0) {
        throw AppException.conflict('This request is no longer pending.');
      }

      await this.activity.record(
        me.id,
        'consent',
        `Declined ${consent.org.name}`,
        { metadata: { consentId: id } },
        tx,
      );
      await this.activity.recordOrg(consent.orgId, null, 'Request Declined', `${consent.user.karevoId} declined access to ${consent.scope.join(', ')}`, 'declined', tx);

      const updated = (await tx.consentRequest.findUniqueOrThrow({
        where: { id },
        include: { org: { select: ORG_SELECT } },
      })) as ConsentWithOrg;

      return toConsentView(updated);
    });
  }

  async revoke(me: RequestUser, id: string, dto: ResolveConsentDto): Promise<ConsentView> {
    return this.prisma.$transaction(async (tx) => {
      const consent = await tx.consentRequest.findFirst({
        where: { id, userId: me.id },
        include: { org: { select: ORG_SELECT }, user: { select: { karevoId: true } } },
      });
      if (!consent) throw AppException.notFound('Consent request');

      const now = new Date();
      if (consent.status !== 'active' || !consent.expiresAt || consent.expiresAt <= now) {
        throw AppException.conflict('Only active consents can be revoked.');
      }

      const updateResult = await tx.consentRequest.updateMany({
        where: { id, status: 'active', expiresAt: { gt: now } },
        data: {
          status: 'revoked',
          resolvedAt: now,
          note: dto.note ?? null,
        },
      });
      if (updateResult.count === 0) {
        throw AppException.conflict('This request is no longer active.');
      }

      await this.activity.record(
        me.id,
        'consent',
        `Revoked ${consent.org.name}'s access`,
        { metadata: { consentId: id } },
        tx,
      );
      await this.activity.recordOrg(consent.orgId, null, 'Access Revoked', `${consent.user.karevoId} revoked access to ${consent.scope.join(', ')}`, 'declined', tx);

      const updated = (await tx.consentRequest.findUniqueOrThrow({
        where: { id },
        include: { org: { select: ORG_SELECT } },
      })) as ConsentWithOrg;

      return toConsentView(updated);
    });
  }
}
