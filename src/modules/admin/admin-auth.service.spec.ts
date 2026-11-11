import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { CryptoService } from '../../crypto/crypto.service';
import { generateTotpCode, generateTotpSecret } from '../../crypto/totp';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminSessionService } from './admin-session.service';

const client = { ip: '127.0.0.1', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0' };

async function setup(overrides: Record<string, unknown> = {}) {
  const config = new ConfigService({
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    BLIND_INDEX_KEY: randomBytes(32).toString('base64'),
    JWT_ADMIN_SECRET: 'admin-secret-that-is-at-least-32-characters-long',
    JWT_ACCESS_TTL_SECONDS: 900,
  });
  const crypto = new CryptoService(config as never);
  const admin: any = {
    id: '6f7c1d1e-0000-4000-8000-0000000000ad',
    email: 'ops@karevo.ng',
    name: 'Ops',
    role: 'ops_support',
    status: 'active',
    passwordHash: await crypto.hashSecret('correct-horse-battery'),
    totpSecretEnc: null,
    totpConfirmedAt: null,
    twoFactorLastStep: null,
    ...overrides,
  };
  const prisma: any = {
    adminUser: {
      findUnique: jest.fn(async ({ where }: any) => (where.email === admin.email || where.id === admin.id ? admin : null)),
      update: jest.fn(async ({ data }: any) => Object.assign(admin, data)),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
  };
  const jwt = new JwtService({});
  const sessions = new AdminSessionService(prisma as PrismaService, jwt, crypto, config as never);
  jest.spyOn(sessions, 'create').mockResolvedValue({ session: { id: 'sess-1' } as never, refreshToken: 'sess-1.secret' });
  const audit = { log: jest.fn() };
  const service = new AdminAuthService(prisma as PrismaService, crypto, sessions, audit as unknown as AdminAuditService);
  return { service, prisma, audit, crypto, admin, jwt };
}

describe('AdminAuthService', () => {
  it('requires MFA setup on first sign-in and returns an authenticator URI', async () => {
    const { service, prisma } = await setup();
    const res = await service.login({ email: 'ops@karevo.ng', password: 'correct-horse-battery' });
    expect(res).toEqual(expect.objectContaining({ mfaRequired: true, mfaSetupRequired: true }));
    expect(res.setupUri).toMatch(/^otpauth:\/\/totp\/.+secret=[A-Z2-7]+/);
    expect(prisma.adminUser.update).toHaveBeenCalled();
  });

  it('never issues tokens from the password alone once MFA is set up', async () => {
    const ctx = await setup({ totpConfirmedAt: new Date() });
    ctx.admin.totpSecretEnc = ctx.crypto.encrypt(generateTotpSecret());
    const res = await ctx.service.login({ email: 'ops@karevo.ng', password: 'correct-horse-battery' });
    expect(res).toEqual({ mfaRequired: true, mfaSetupRequired: false, challengeToken: expect.any(String) });
    expect(res).not.toHaveProperty('accessToken');
  });

  it('logs failed passwords against the admin', async () => {
    const { service, audit } = await setup();
    const err = await service.login({ email: 'ops@karevo.ng', password: 'wrong' }).catch((e) => e);
    expect((err as AppException).code).toBe(ErrorCode.INVALID_CREDENTIALS);
    expect(audit.log).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'admin.sign_in_failed' }));
  });

  it('signs in with a valid code and refuses a replayed one', async () => {
    const secret = generateTotpSecret();
    const ctx = await setup();
    ctx.admin.totpSecretEnc = ctx.crypto.encrypt(secret);
    ctx.admin.totpConfirmedAt = new Date();
    const { challengeToken } = await ctx.service.login({ email: 'ops@karevo.ng', password: 'correct-horse-battery' });

    const ok = await ctx.service.verifyTwoFactor({ challengeToken, code: generateTotpCode(secret) }, client);
    expect(ok.body.accessToken).toEqual(expect.any(String));

    // The conditional update finds the step already used.
    ctx.prisma.adminUser.updateMany.mockResolvedValue({ count: 0 });
    const err = await ctx.service.verifyTwoFactor({ challengeToken, code: generateTotpCode(secret) }, client).catch((e) => e);
    expect((err as AppException).code).toBe(ErrorCode.INVALID_CREDENTIALS);
  });

  it('rejects a challenge signed with the patient secret', async () => {
    const { service, jwt } = await setup();
    const forged = await jwt.signAsync({ sub: 'x', typ: 'admin_2fa' }, { secret: 'test-secret-that-is-at-least-32-characters-long' });
    const err = await service.verifyTwoFactor({ challengeToken: forged, code: '123456' }, client).catch((e) => e);
    expect((err as AppException).getStatus()).toBe(401);
  });
});
