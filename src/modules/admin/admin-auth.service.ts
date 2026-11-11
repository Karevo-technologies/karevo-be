import { Injectable } from '@nestjs/common';
import { AdminUser } from '@prisma/client';
import { AppException } from '../../common/errors/app.exception';
import { CryptoService } from '../../crypto/crypto.service';
import { generateTotpSecret, matchTotpStep } from '../../crypto/totp';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientContext, describeDevice } from '../auth/device';
import { ADMIN_SESSION } from './admin-context';
import { AdminAuditService } from './admin-audit.service';
import { AdminSessionService } from './admin-session.service';
import { AdminAuthResponse, AdminChallengeResponse, AdminLoginDto, AdminTwoFactorDto, AdminView } from './dto/admin.dto';

interface ChallengePayload {
  sub: string;
  typ: 'admin_2fa';
}

export function toAdminView(a: AdminUser): AdminView {
  return { id: a.id, email: a.email, name: a.name, role: a.role };
}

/**
 * Admin sign-in. MFA is mandatory with no exceptions (admin spec §6): step 1
 * checks the password and returns a challenge; step 2 checks a TOTP code. On
 * the first sign-in step 1 also returns the authenticator setup URI, and the
 * first valid code confirms it.
 */
@Injectable()
export class AdminAuthService {
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly sessions: AdminSessionService,
    private readonly audit: AdminAuditService,
  ) {}

  async login(dto: AdminLoginDto): Promise<AdminChallengeResponse> {
    const admin = await this.prisma.adminUser.findUnique({ where: { email: dto.email } });
    if (!admin) {
      await this.crypto.verifySecret(await this.getDummyHash(), dto.password);
      throw AppException.invalidCredentials();
    }
    const ok = await this.crypto.verifySecret(admin.passwordHash, dto.password);
    if (!ok || admin.status !== 'active') {
      await this.audit.log(admin.id, { action: 'admin.sign_in_failed', targetType: 'admin', targetId: admin.id, reasonCode: 'auth' });
      throw AppException.invalidCredentials();
    }

    const challengeToken = await this.sessions.sign(
      { sub: admin.id, typ: 'admin_2fa' } satisfies ChallengePayload,
      ADMIN_SESSION.challengeTtlSeconds,
    );
    if (admin.totpConfirmedAt && admin.totpSecretEnc) {
      return { mfaRequired: true, mfaSetupRequired: false, challengeToken };
    }

    // First sign-in: keep one pending secret until it is confirmed, so reloading the page shows the same QR.
    let secret = admin.totpSecretEnc ? this.crypto.decrypt(admin.totpSecretEnc) : null;
    if (!secret) {
      secret = generateTotpSecret();
      await this.prisma.adminUser.update({ where: { id: admin.id }, data: { totpSecretEnc: this.crypto.encrypt(secret) } });
    }
    const label = encodeURIComponent(`Karevo Admin:${admin.email}`);
    const setupUri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('Karevo Admin')}`;
    return { mfaRequired: true, mfaSetupRequired: true, setupUri, challengeToken };
  }

  async verifyTwoFactor(dto: AdminTwoFactorDto, client: ClientContext): Promise<{ body: AdminAuthResponse; refreshToken: string }> {
    let payload: ChallengePayload;
    try {
      payload = await this.sessions.verify<ChallengePayload>(dto.challengeToken);
    } catch {
      throw AppException.unauthenticated('Your sign-in expired. Start again.');
    }
    if (payload.typ !== 'admin_2fa') throw AppException.unauthenticated();

    const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.sub } });
    if (!admin || admin.status !== 'active' || !admin.totpSecretEnc) throw AppException.invalidCredentials();

    const step = matchTotpStep(this.crypto.decrypt(admin.totpSecretEnc), dto.code);
    // Conditional update: a code (or an older one) is accepted at most once, even concurrently.
    const accepted =
      step !== null &&
      (
        await this.prisma.adminUser.updateMany({
          where: { id: admin.id, OR: [{ twoFactorLastStep: null }, { twoFactorLastStep: { lt: step } }] },
          data: {
            twoFactorLastStep: step,
            lastLoginAt: new Date(),
            ...(admin.totpConfirmedAt ? {} : { totpConfirmedAt: new Date() }),
          },
        })
      ).count === 1;
    if (!accepted) {
      await this.audit.log(admin.id, { action: 'admin.sign_in_failed', targetType: 'admin', targetId: admin.id, reasonCode: 'auth', note: 'Wrong or reused MFA code' });
      throw AppException.invalidCredentials();
    }

    const { session, refreshToken } = await this.sessions.create(admin.id, client);
    await this.audit.log(admin.id, {
      action: admin.totpConfirmedAt ? 'admin.sign_in' : 'admin.mfa_setup',
      targetType: 'admin',
      targetId: admin.id,
      reasonCode: 'auth',
      metadata: { device: describeDevice(client.userAgent).deviceName },
    });
    const tokens = await this.sessions.issueAccessToken(admin.id, session.id);
    return { body: { ...tokens, admin: toAdminView(admin) }, refreshToken };
  }

  async refresh(refreshToken: string) {
    const { session, refreshToken: next } = await this.sessions.store.rotate(refreshToken);
    await this.sessions.validateForRequest(session.id, session.adminId);
    const tokens = await this.sessions.issueAccessToken(session.adminId, session.id);
    return { body: tokens, refreshToken: next };
  }

  async logout(refreshToken: string | undefined) {
    if (refreshToken) await this.sessions.store.revokeByToken(refreshToken);
  }

  async me(adminId: string): Promise<AdminView> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin) throw AppException.notFound('Admin');
    return toAdminView(admin);
  }

  private getDummyHash() {
    this.dummyHash ??= this.crypto.hashSecret(this.crypto.randomToken());
    return this.dummyHash;
  }
}
