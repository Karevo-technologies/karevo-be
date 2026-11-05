import { AppException } from '../../common/errors/app.exception';
import { ActivityService } from '../../activity/activity.service';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SharingService } from './sharing.service';

describe('SharingService', () => {
  let service: SharingService;
  let prisma: any;
  let crypto: any;
  let activity: any;

  const me = { id: 'user-1', sessionId: 'sess-1', ninStatus: 'verified' as const };

  beforeEach(() => {
    prisma = {
      shareToken: {
        create: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      scanRequest: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };
    crypto = {
      shareCode: jest.fn(() => 'ABCD-EFGH'),
      blindIndex: jest.fn((val: string) => `blind:${val}`),
    };
    activity = {
      record: jest.fn(),
    };
    service = new SharingService(
      prisma as PrismaService,
      crypto as CryptoService,
      activity as ActivityService,
    );
  });

  it('creates a share token returning the plain code once', async () => {
    prisma.shareToken.create.mockResolvedValue({
      id: 'token-1',
      userId: 'user-1',
      codeHash: 'blind:ABCD-EFGH',
      label: 'Clinic visit',
      categories: ['blood'],
      expiry: 'h1',
      expiresAt: new Date(Date.now() + 3600000),
      createdAt: new Date(),
    });

    const res = await service.createToken(me, {
      categories: ['blood'],
      expiry: '1h',
      label: 'Clinic visit',
    });

    expect(res.id).toBe('token-1');
    expect(res.code).toBe('ABCD-EFGH');
    expect(res.expiry).toBe('1h');
    expect(activity.record).toHaveBeenCalledWith('user-1', 'create', 'Share token created', {}, prisma);
  });

  it('revokes an active share token', async () => {
    prisma.shareToken.updateMany.mockResolvedValue({ count: 1 });

    await service.revokeToken(me, 'token-1');
    expect(prisma.shareToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'token-1', userId: 'user-1', revokedAt: null },
      }),
    );
    expect(activity.record).toHaveBeenCalledWith('user-1', 'create', 'Share token revoked');
  });

  it('resolves a valid QR payload', async () => {
    const scanRequestId = '6f7c1d1e-0000-4000-8000-000000000001';
    prisma.scanRequest.findUnique.mockResolvedValue({
      id: scanRequestId,
      org: { id: 'org-1', name: 'LUTH', kind: 'hospital', verified: true },
      requestedCategories: ['blood', 'vaccines'],
      expiresAt: new Date(Date.now() + 300000),
      confirmedAt: null,
      userId: null,
    });

    const res = await service.resolveScan(me, { payload: `kv1.${scanRequestId}.sig123` });
    expect(res.requestId).toBe(scanRequestId);
    expect(res.requestedCategories).toEqual(['blood', 'vaccines']);
    expect(prisma.scanRequest.updateMany).toHaveBeenCalledWith({
      where: {
        id: scanRequestId,
        confirmedAt: null,
        OR: [{ userId: null }, { userId: 'user-1' }],
      },
      data: { userId: 'user-1' },
    });
  });

  it('refuses a scan request another user claimed at the same time', async () => {
    const scanRequestId = '6f7c1d1e-0000-4000-8000-000000000001';
    prisma.scanRequest.findUnique.mockResolvedValue({
      id: scanRequestId,
      org: { id: 'org-1', name: 'LUTH', kind: 'hospital', verified: true },
      requestedCategories: ['blood'],
      expiresAt: new Date(Date.now() + 300000),
      confirmedAt: null,
      userId: null,
    });
    prisma.scanRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.resolveScan(me, { payload: `kv1.${scanRequestId}` })).rejects.toThrow(AppException);
  });
});

