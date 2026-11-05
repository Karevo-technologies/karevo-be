import { Injectable } from '@nestjs/common';
import { ActivityEvent, LinkedId, Preferences, Prisma, Session } from '@prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { RequestUser } from '../../common/auth/request-user';
import { AppException } from '../../common/errors/app.exception';
import { Page, pageArgs, toPage } from '../../common/pagination/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import {
  ActivityView,
  IntegrityView,
  LinkedIdView,
  ListActivityQueryDto,
  PreferencesView,
  SessionView,
  UpdatePreferencesDto,
} from './dto/settings.dto';

function toPreferencesView(p: Preferences): PreferencesView {
  return {
    notifyEmail: p.notifyEmail,
    notifySms: p.notifySms,
    notifyPush: p.notifyPush,
    autoSignOutMinutes: p.autoSignOutMinutes,
    offlineEnabled: p.offlineEnabled,
    offlineCardOnly: p.offlineCardOnly,
  };
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly activity: ActivityService,
  ) {}

  async getPreferences(me: RequestUser): Promise<PreferencesView> {
    const preferences = await this.prisma.preferences.upsert({
      where: { userId: me.id },
      create: { userId: me.id },
      update: {},
    });
    return toPreferencesView(preferences);
  }

  async updatePreferences(me: RequestUser, dto: UpdatePreferencesDto): Promise<PreferencesView> {
    const updated = await this.prisma.preferences.upsert({
      where: { userId: me.id },
      create: { userId: me.id, ...dto },
      update: { ...dto },
    });
    return toPreferencesView(updated);
  }

  async listLinkedIds(me: RequestUser): Promise<LinkedIdView[]> {
    const rows = await this.prisma.linkedId.findMany({
      where: { userId: me.id },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r: LinkedId) => ({
      id: r.id,
      type: r.type,
      numberMasked: `*******${r.numberLast4}`,
      status: r.status,
    }));
  }

  async listSessions(me: RequestUser): Promise<SessionView[]> {
    const now = new Date();
    const rows = await this.prisma.session.findMany({
      where: {
        userId: me.id,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { lastActiveAt: 'desc' },
    });

    return rows.map((s: Session) => ({
      id: s.id,
      deviceName: s.deviceName,
      detail: s.detail,
      location: s.location,
      lastActiveAt: s.lastActiveAt.toISOString(),
      current: s.id === me.sessionId,
    }));
  }

  async revokeSession(me: RequestUser, id: string): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id } });
    if (!session || session.userId !== me.id || session.revokedAt) {
      throw AppException.notFound('Device');
    }

    await this.sessions.revoke(id);
    await this.activity.record(me.id, 'auth', `Device removed: ${session.deviceName}`);
  }

  async revokeOtherSessions(me: RequestUser): Promise<void> {
    const now = new Date();
    await this.prisma.session.updateMany({
      where: {
        userId: me.id,
        revokedAt: null,
        id: { not: me.sessionId },
      },
      data: { revokedAt: now },
    });
    await this.activity.record(me.id, 'auth', 'Signed out other sessions');
  }

  async listActivity(me: RequestUser, query: ListActivityQueryDto): Promise<Page<ActivityView>> {
    const where: Prisma.ActivityEventWhereInput = {
      userId: me.id,
      ...(query.kind ? { kind: query.kind } : {}),
    };

    const rows = await this.prisma.activityEvent.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      ...pageArgs(query),
    });

    return toPage(rows, query.limit, (r: ActivityEvent) => ({
      id: r.id,
      kind: r.kind,
      event: r.event,
      device: r.device,
      location: r.location,
      occurredAt: r.occurredAt.toISOString(),
    }));
  }

  async getIntegrity(me: RequestUser): Promise<IntegrityView> {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [user, failedSignIns, activeSessionsCount] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: me.id },
        select: { ninStatus: true, twoFactorEnabled: true, pinHash: true },
      }),
      this.prisma.activityEvent.count({
        where: {
          userId: me.id,
          kind: 'auth',
          event: 'Failed sign-in attempt',
          occurredAt: { gte: thirtyDaysAgo },
        },
      }),
      this.prisma.session.count({
        where: {
          userId: me.id,
          revokedAt: null,
          expiresAt: { gt: now },
          lastActiveAt: { gte: thirtyDaysAgo },
        },
      }),
    ]);

    const ninOk = user?.ninStatus === 'verified';
    const twoFactorOk = user?.twoFactorEnabled === true;
    const pinOk = Boolean(user?.pinHash);
    const noFailedSignInOk = failedSignIns === 0;
    const sessionCountOk = activeSessionsCount <= 3;

    const factors = [
      { key: 'nin_verified', label: 'NIN verified', ok: ninOk, weight: 30 },
      { key: 'two_factor', label: 'Two-factor authentication enabled', ok: twoFactorOk, weight: 25 },
      { key: 'pin_set', label: 'Security PIN configured', ok: pinOk, weight: 15 },
      { key: 'no_failed_logins', label: 'No failed sign-in attempts in 30 days', ok: noFailedSignInOk, weight: 15 },
      { key: 'active_sessions', label: '3 or fewer active devices in 30 days', ok: sessionCountOk, weight: 15 },
    ];

    const score = factors.reduce((sum, f) => (f.ok ? sum + f.weight : sum), 0);

    return {
      score,
      factors: factors.map(({ key, label, ok }) => ({ key, label, ok })),
    };
  }
}
