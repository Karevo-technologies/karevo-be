import { AppException } from '../../common/errors/app.exception';
import { ActivityService } from '../../activity/activity.service';
import { CryptoService } from '../../crypto/crypto.service';
import { currentTotpStep, generateTotpCode, generateTotpSecret } from '../../crypto/totp';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountService } from './account.service';

describe('AccountService', () => {
  let service: AccountService;
  let prisma: any;
  let crypto: any;
  let activity: any;

  const me = { id: 'user-1', sessionId: 'sess-1', ninStatus: 'verified' as const };

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      session: {
        updateMany: jest.fn(),
      },
      healthRecord: {
        count: jest.fn(),
      },
      consentRequest: {
        count: jest.fn(),
      },
      dataExportJob: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };
    crypto = {
      verifySecret: jest.fn(),
      hashSecret: jest.fn(async (s: string) => `hash:${s}`),
      encrypt: jest.fn((s: string) => `enc:${s}`),
      decrypt: jest.fn((s: string) => `dec:${s}`),
    };
    activity = {
      record: jest.fn(),
    };
    service = new AccountService(
      prisma as PrismaService,
      crypto as CryptoService,
      activity as ActivityService,
    );
  });

  it('updates profile name and records activity', async () => {
    prisma.user.update.mockResolvedValue({
      id: 'user-1',
      karevoId: 'KV-1234-5678',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      ninLast4: '1234',
      ninStatus: 'verified',
      twoFactorEnabled: false,
      createdAt: new Date(),
    });

    const res = await service.updateMe(me, { name: 'Ada Lovelace' });
    expect(res.name).toBe('Ada Lovelace');
    expect(activity.record).toHaveBeenCalledWith('user-1', 'auth', 'Profile updated');
  });

  it('changes password, revokes other sessions, and hashes with argon2', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      passwordHash: 'old-hash',
    });
    crypto.verifySecret.mockResolvedValue(true);

    await service.changePassword(me, {
      currentPassword: 'old-password',
      newPassword: 'brand-new-strong-password',
    });

    expect(prisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1', id: { not: 'sess-1' } }),
      }),
    );
    expect(activity.record).toHaveBeenCalledWith('user-1', 'auth', 'Password changed', {}, prisma);
  });

  it('aggregates summary counts correctly', async () => {
    prisma.healthRecord.count.mockResolvedValue(5);
    prisma.consentRequest.count
      .mockResolvedValueOnce(2) // pending
      .mockResolvedValueOnce(3) // active
      .mockResolvedValueOnce(1); // declined

    const res = await service.getSummary(me);
    expect(res).toEqual({
      totalRecords: 5,
      pendingRequests: 2,
      activeConsents: 3,
      declined: 1,
    });
  });

  it('returns unmasked NIN on id-card endpoint', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      karevoId: 'KV-1111-2222',
      name: 'Ada',
      ninEnc: 'enc-nin',
      ninStatus: 'verified',
    });
    crypto.decrypt.mockReturnValue('12345678901');

    const res = await service.getIdCard(me);
    expect(res.nin).toBe('12345678901');
  });

  describe('two-factor', () => {
    const secret = generateTotpSecret();
    const enabledUser = {
      id: 'user-1',
      email: 'ada@example.com',
      passwordHash: 'hash',
      twoFactorEnabled: true,
      twoFactorSecretEnc: 'enc-secret',
      twoFactorLastStep: null,
    };

    beforeEach(() => {
      crypto.decrypt.mockReturnValue(secret);
    });

    it('refuses to start setup again while 2FA is on, keeping the secret', async () => {
      prisma.user.findUnique.mockResolvedValue(enabledUser);
      await expect(service.setTwoFactor(me, { enabled: true })).rejects.toThrow(AppException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('requires a password or code to turn 2FA off', async () => {
      prisma.user.findUnique.mockResolvedValue(enabledUser);
      await expect(service.setTwoFactor(me, { enabled: false })).rejects.toThrow(AppException);

      crypto.verifySecret.mockResolvedValue(false);
      await expect(service.setTwoFactor(me, { enabled: false, password: 'wrong' })).rejects.toThrow(AppException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('turns 2FA off with the correct password', async () => {
      prisma.user.findUnique.mockResolvedValue(enabledUser);
      crypto.verifySecret.mockResolvedValue(true);

      const res = await service.setTwoFactor(me, { enabled: false, password: 'right' });
      expect(res.enabled).toBe(false);
      expect(activity.record).toHaveBeenCalledWith('user-1', 'auth', '2FA disabled');
    });

    it('refuses a code that was already used', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...enabledUser,
        twoFactorEnabled: false,
        twoFactorLastStep: currentTotpStep() + 1,
      });

      await expect(service.confirmTwoFactor(me, { code: generateTotpCode(secret) })).rejects.toThrow(AppException);
    });
  });

  it('counts a wrong PIN with an atomic increment', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', pinHash: 'pin-hash', pinFailedCount: 0 });
    prisma.user.update.mockResolvedValue({ pinFailedCount: 1 });
    crypto.verifySecret.mockResolvedValue(false);

    await expect(service.verifyPin(me, { pin: '4821' })).rejects.toThrow(AppException);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { pinFailedCount: { increment: 1 } } }),
    );
  });
});

