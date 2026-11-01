import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { ActivityService } from '../../activity/activity.service';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { CryptoService } from '../../crypto/crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

const client = { ip: '127.0.0.1', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0' };
const valid = { email: 'ada@example.com', password: 'correct-horse', nin: '12345678901' };

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
  const prisma = {
    user: { findUnique: jest.fn(async ({ where }) => (where.email === user.email ? user : null)) },
  } as unknown as PrismaService;
  const session = { id: '6f7c1d1e-0000-4000-8000-0000000000aa', deviceName: 'Chrome on Windows', location: null };
  const sessions = {
    create: jest.fn(async () => ({ session, refreshToken: `${session.id}.secret` })),
    issueAccessToken: jest.fn(async () => ({ accessToken: 'access', expiresIn: 900 })),
  } as unknown as SessionService;
  const activity = { record: jest.fn() } as unknown as ActivityService;
  const jwt = new JwtService({ secret: 'test-secret-that-is-at-least-32-characters-long' });
  return { service: new AuthService(prisma, crypto, sessions, activity, jwt), sessions, activity };
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
  });

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
