import { AppException } from '../../common/errors/app.exception';
import { ActivityService } from '../../activity/activity.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConsentsService } from './consents.service';

describe('ConsentsService', () => {
  let service: ConsentsService;
  let prisma: any;
  let activity: any;

  const me = { id: 'user-1', sessionId: 'sess-1', ninStatus: 'verified' as const };
  const mockOrg = { id: 'org-1', name: 'Synlab', kind: 'lab' as const, verified: true };

  beforeEach(() => {
    prisma = {
      consentRequest: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };
    activity = {
      record: jest.fn(),
    };
    service = new ConsentsService(prisma as PrismaService, activity as ActivityService);
  });

  it('lists pending consents ordered by requestedAt desc', async () => {
    prisma.consentRequest.findMany.mockResolvedValue([
      {
        id: 'c-1',
        org: mockOrg,
        scope: ['blood'],
        purpose: 'Test',
        status: 'pending',
        requestedDays: 30,
        requestedAt: new Date('2026-10-01'),
        grantedDays: null,
        grantedAt: null,
        expiresAt: null,
        resolvedAt: null,
        note: null,
      },
    ]);

    const res = await service.list(me, { status: 'pending', limit: 20 });
    expect(res.data).toHaveLength(1);
    expect(res.data[0].status).toBe('pending');
    expect(prisma.consentRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', status: 'pending' },
      }),
    );
  });

  it('approves a pending consent and logs an activity event', async () => {
    const existing = {
      id: 'c-1',
      userId: 'user-1',
      status: 'pending',
      org: mockOrg,
    };
    prisma.consentRequest.findFirst.mockResolvedValue(existing);
    prisma.consentRequest.updateMany.mockResolvedValue({ count: 1 });
    prisma.consentRequest.findUniqueOrThrow.mockResolvedValue({
      ...existing,
      status: 'active',
      scope: ['blood'],
      purpose: 'Test',
      requestedDays: 30,
      requestedAt: new Date(),
      grantedDays: 30,
      grantedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 86400000),
      resolvedAt: new Date(),
      note: null,
    });

    const res = await service.approve(me, 'c-1', { days: 30 });
    expect(res.status).toBe('active');
    expect(prisma.consentRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c-1', status: 'pending' },
      }),
    );
    expect(activity.record).toHaveBeenCalledWith(
      'user-1',
      'consent',
      expect.stringContaining('Granted Synlab access'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('refuses approval of a non-pending consent with CONFLICT', async () => {
    prisma.consentRequest.findFirst.mockResolvedValue({
      id: 'c-1',
      userId: 'user-1',
      status: 'active',
      org: mockOrg,
    });

    await expect(service.approve(me, 'c-1', { days: 30 })).rejects.toThrow(AppException);
  });
});

