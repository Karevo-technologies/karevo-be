import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { ActivityService } from '../../activity/activity.service';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { CryptoService } from '../../crypto/crypto.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
import { PasswordPolicyService } from './password-policy';
import { SessionService } from './session.service';

const client = { ip: '127.0.0.1', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0' };
const valid = { email: 'ada@example.com', password: 'correct-horse', nin: '12345678901' };

jest.setTimeout(30000);

async function setup(userOverrides: Record<string, unknown> = {}) {
  const crypto = new CryptoService(
    new ConfigService({
      DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      BLIND_INDEX_KEY: randomBytes(32).toString('base64'),
    }) as never,
  );
  const user = {
    id: '6f7c1d1e-0000-4000-8000-000000000001',
    karevoId: 'KV-0000-0001',
    name: 'Ada',
    email: valid.email,
    passwordHash: await crypto.hashSecret(valid.password),
    ninHash: crypto.blindIndex(valid.nin),
    ninLast4: '8901',
    ninStatus: 'verified',
    twoFactorEnabled: false,
    deactivatedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...userOverrides,
  };
  const prisma: any = {
    user: { findUnique: jest.fn(async ({ where }) => (where.email === user.email ? user : null)), update: jest.fn() },
    passwordResetToken: { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(async () => ({ count: 1 })) },
    session: { updateMany: jest.fn() },
    $transaction: jest.fn(async (arg) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma))),
  };
  const session = { id: '6f7c1d1e-0000-4000-8000-0000000000aa', deviceName: 'Chrome on Windows', location: null };
  const sessions = {
    create: jest.fn(async () => ({ session, refreshToken: `${session.id}.secret` })),
    issueAccessToken: jest.fn(async () => ({ accessToken: 'access', expiresIn: 900 })),
  } as unknown as SessionService;
  const activity = { record: jest.fn() } as unknown as ActivityService;
  const jwt = new JwtService({ secret: 'test-secret-that-is-at-least-32-characters-long' });
  const mail = { sendPasswordResetLink: jest.fn() } as unknown as MailService;
  const passwordPolicy = { isBreached: jest.fn(async () => false) } as unknown as PasswordPolicyService;
  return {
    service: new AuthService(prisma as PrismaService, crypto, sessions, activity, jwt, mail, passwordPolicy),
    prisma,
    sessions,
    activity,
    mail,
  };
}

async function expectInvalidCredentials(p: Promise<unknown>) {
  const err = await p.catch((e) => e);
  expect(err).toBeInstanceOf(AppException);
  expect((err as AppException).code).toBe(ErrorCode.INVALID_CREDENTIALS);
  expect((err as AppException).getStatus()).toBe(401);
  return err as AppException;
}

describe('AuthService.login', () => {
  it('creates a session and returns tokens plus the masked user', async () => {
    const { service, sessions } = await setup();
    const result = await service.login(valid, client);
    expect(result.kind).toBe('session');
    if (result.kind !== 'session') return;
    expect(result.body.accessToken).toBe('access');
    expect(result.body.user.nin).toBe('*******8901');
    expect(result.refreshToken).toContain('.');
    expect(sessions.create).toHaveBeenCalledTimes(1);
  });

  it('returns the same error for a wrong email, password or NIN', async () => {
    const { service, sessions } = await setup();
    const messages = await Promise.all([
      expectInvalidCredentials(service.login({ ...valid, email: 'nobody@example.com' }, client)),
      expectInvalidCredentials(service.login({ ...valid, password: 'wrong-password' }, client)),
      expectInvalidCredentials(service.login({ ...valid, nin: '10987654321' }, client)),
    ]);
    expect(new Set(messages.map((m) => m.message)).size).toBe(1);
    expect(sessions.create).not.toHaveBeenCalled();
  }, 15000);

  it('logs failed attempts on a known account', async () => {
    const { service, activity } = await setup();
    await expectInvalidCredentials(service.login({ ...valid, password: 'wrong-password' }, client));
    expect(activity.record).toHaveBeenCalledWith(expect.any(String), 'auth', 'Failed sign-in attempt', expect.anything());
  });

  it('refuses deactivated accounts with the generic error', async () => {
    const { service } = await setup({ deactivatedAt: new Date() });
    await expectInvalidCredentials(service.login(valid, client));
  });

  it('returns a 2FA challenge instead of a session when 2FA is on', async () => {
    const { service, sessions } = await setup({ twoFactorEnabled: true });
    const result = await service.login(valid, client);
    expect(result.kind).toBe('challenge');
    expect(sessions.create).not.toHaveBeenCalled();
  });
});

describe('AuthService password reset', () => {
  const resetDto = { token: 'reset-token', newPassword: 'a-brand-new-strong-password' };
  const liveToken = (overrides: Record<string, unknown> = {}) => ({
    id: 'reset-1',
    userId: '6f7c1d1e-0000-4000-8000-000000000001',
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: { deactivatedAt: null },
    ...overrides,
  });

  it('cancels earlier links when a new one is requested', async () => {
    const { service, prisma, mail } = await setup();
    await service.forgotPassword({ email: valid.email });
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ usedAt: null }) }),
    );
    expect(mail.sendPasswordResetLink).toHaveBeenCalledTimes(1);
  });

  it('resets the password and revokes every session', async () => {
    const { service, prisma } = await setup();
    prisma.passwordResetToken.findUnique.mockResolvedValue(liveToken());
    await service.resetPassword(resetDto);
    expect(prisma.user.update).toHaveBeenCalled();
    expect(prisma.session.updateMany).toHaveBeenCalled();
  });

  it('lets a token be used only once, even concurrently', async () => {
    const { service, prisma } = await setup();
    prisma.passwordResetToken.findUnique.mockResolvedValue(liveToken());
    prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.resetPassword(resetDto)).rejects.toThrow(AppException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses a reset for a deactivated account', async () => {
    const { service, prisma } = await setup();
    prisma.passwordResetToken.findUnique.mockResolvedValue(liveToken({ user: { deactivatedAt: new Date() } }));
    await expect(service.resetPassword(resetDto)).rejects.toThrow(AppException);
  });
});
