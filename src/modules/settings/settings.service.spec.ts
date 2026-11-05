import { AppException } from '../../common/errors/app.exception';
import { ActivityService } from '../../activity/activity.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  let service: SettingsService;
  let prisma: any;
  let sessions: any;
  let activity: any;

  const me = { id: 'user-1', sessionId: 'sess-1', ninStatus: 'verified' as const };

  beforeEach(() => {
    prisma = {
      preferences: {
        upsert: jest.fn(),
      },
      linkedId: {
        findMany: jest.fn(),
      },
      session: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      activityEvent: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
    };
    sessions = {
      revoke: jest.fn(),
    };
    activity = {
      record: jest.fn(),
    };
    service = new SettingsService(
      prisma as PrismaService,
      sessions as SessionService,
      activity as ActivityService,
    );
  });

  it('upserts and returns user preferences', async () => {
    prisma.preferences.upsert.mockResolvedValue({
      userId: 'user-1',
      notifyEmail: true,
      notifySms: false,
      notifyPush: true,
      autoSignOutMinutes: 15,
      offlineEnabled: false,
      offlineCardOnly: true,
    });

    const res = await service.getPreferences(me);
    expect(res.notifyEmail).toBe(true);
    expect(res.autoSignOutMinutes).toBe(15);
  });

  it('lists active sessions and correctly identifies the current session', async () => {
    prisma.session.findMany.mockResolvedValue([
      {
        id: 'sess-1',
        deviceName: 'Chrome on Mac',
        detail: 'Chrome · macOS',
        location: 'Lagos',
        lastActiveAt: new Date(),
      },
      {
        id: 'sess-2',
        deviceName: 'Safari on iPhone',
        detail: 'Safari · iOS',
        location: 'Abuja',
        lastActiveAt: new Date(),
      },
    ]);

    const res = await service.listSessions(me);
    expect(res).toHaveLength(2);
    expect(res[0].current).toBe(true);
    expect(res[1].current).toBe(false);
  });

  it('revokes a specific device session', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'sess-2',
      userId: 'user-1',
      deviceName: 'Safari on iPhone',
      revokedAt: null,
    });

    await service.revokeSession(me, 'sess-2');
    expect(sessions.revoke).toHaveBeenCalledWith('sess-2');
    expect(activity.record).toHaveBeenCalledWith('user-1', 'auth', 'Device removed: Safari on iPhone');
  });

  it('throws notFound when attempting to revoke another users session', async () => {
    prisma.session.findUnique.mockResolvedValue({
      id: 'sess-2',
      userId: 'user-other',
      deviceName: 'Safari on iPhone',
      revokedAt: null,
    });

    await expect(service.revokeSession(me, 'sess-2')).rejects.toThrow(AppException);
  });
});

