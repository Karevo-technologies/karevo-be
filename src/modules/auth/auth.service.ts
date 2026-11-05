import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ActivityService } from '../../activity/activity.service';
import { AppException } from '../../common/errors/app.exception';
import { toUserView } from '../../common/presenters/user.presenter';
import { CryptoService } from '../../crypto/crypto.service';
import { MailService } from '../../mail/mail.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ClientContext, describeDevice } from './device';
import {
  AuthResponse,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  TwoFactorChallengeResponse,
  TwoFactorVerifyDto,
} from './dto/auth.dto';
import { isBreachedPassword } from './password-policy';
import { SessionService } from './session.service';
import { consumeTotpCode } from './two-factor';

const TWO_FACTOR_CHALLENGE_TTL = 300;

export type LoginResult =
  | { kind: 'session'; body: AuthResponse; refreshToken: string }
  | { kind: 'challenge'; body: TwoFactorChallengeResponse };

@Injectable()
export class AuthService {
  // Verified against when the email is unknown, so response time does not reveal which emails exist.
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly sessions: SessionService,
    private readonly activity: ActivityService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  async register(dto: RegisterDto, client: ClientContext): Promise<{ body: AuthResponse; refreshToken: string }> {
    if (isBreachedPassword(dto.password)) {
      throw AppException.validation({ password: 'This password is too common. Choose another.' });
    }

    const ninHash = this.crypto.blindIndex(dto.nin);
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { ninHash }] },
      select: { id: true },
    });
    if (existing) throw AppException.conflict('An account with this email or NIN already exists.');

    const [passwordHash, karevoId] = await Promise.all([
      this.crypto.hashSecret(dto.password),
      this.uniqueKarevoId(),
    ]);
    const ninEnc = this.crypto.encrypt(dto.nin);
    const ninLast4 = dto.nin.slice(-4);

    const { user, session, refreshToken } = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          karevoId,
          name: dto.name,
          email: dto.email,
          passwordHash,
          ninEnc,
          ninHash,
          ninLast4,
          preferences: { create: {} },
          linkedIds: { create: { type: 'nin', numberEnc: ninEnc, numberLast4: ninLast4 } },
        },
      });
      const { session, refreshToken } = await this.sessions.create(user.id, client, tx);
      await this.activity.record(user.id, 'create', 'Account created', this.where(session), tx);
      return { user, session, refreshToken };
    });

    // NIN verification runs out of band (jobs/nin-verification.job.ts); user.ninStatus stays `pending` until then.
    const tokens = await this.sessions.issueAccessToken(user.id, session.id);
    return { body: { ...tokens, user: toUserView(user) }, refreshToken };
  }

  async login(dto: LoginDto, client: ClientContext): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    if (!user) {
      await this.crypto.verifySecret(await this.getDummyHash(), dto.password);
      throw AppException.invalidCredentials();
    }

    const passwordOk = await this.crypto.verifySecret(user.passwordHash, dto.password);
    const ninOk = this.crypto.safeEqual(user.ninHash, this.crypto.blindIndex(dto.nin));
    if (!passwordOk || !ninOk || user.deactivatedAt) {
      await this.activity.record(user.id, 'auth', 'Failed sign-in attempt', {
        device: describeDevice(client.userAgent).deviceName,
      });
      throw AppException.invalidCredentials();
    }

    if (user.twoFactorEnabled) {
      const challengeToken = await this.jwt.signAsync(
        { sub: user.id, typ: '2fa' },
        { expiresIn: TWO_FACTOR_CHALLENGE_TTL },
      );
      return { kind: 'challenge', body: { twoFactorRequired: true, challengeToken } };
    }

    const { session, refreshToken } = await this.sessions.create(user.id, client);
    await this.activity.record(user.id, 'auth', 'Signed in', this.where(session));
    const tokens = await this.sessions.issueAccessToken(user.id, session.id);
    return { kind: 'session', body: { ...tokens, user: toUserView(user) }, refreshToken };
  }

  /**
   * Second login step when 2FA is on: verify `challengeToken` (typ "2fa",
   * 5 min) and the TOTP `code` against the decrypted `twoFactorSecretEnc`,
   * then create the session exactly as `login` does. See README "2FA".
   */
  async verifyTwoFactor(
    dto: TwoFactorVerifyDto,
    client: ClientContext,
  ): Promise<{ body: AuthResponse; refreshToken: string }> {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(dto.challengeToken);
    } catch {
      throw AppException.unauthenticated('Invalid or expired 2FA challenge token.');
    }

    if (payload?.typ !== '2fa' || !payload?.sub) {
      throw AppException.unauthenticated('Invalid 2FA challenge token.');
    }

    const userId = payload.sub as string;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorSecretEnc || user.deactivatedAt) {
      throw AppException.invalidCredentials();
    }

    const secret = this.crypto.decrypt(user.twoFactorSecretEnc);
    const codeOk = await consumeTotpCode(this.prisma, user, secret, dto.code);
    if (!codeOk) {
      await this.activity.record(user.id, 'auth', 'Failed 2FA sign-in attempt', {
        device: describeDevice(client.userAgent).deviceName,
      });
      throw AppException.invalidCredentials();
    }

    const { session, refreshToken } = await this.sessions.create(user.id, client);
    await this.activity.record(user.id, 'auth', 'Signed in', this.where(session));
    const tokens = await this.sessions.issueAccessToken(user.id, session.id);
    return { body: { ...tokens, user: toUserView(user) }, refreshToken };
  }

  async refresh(refreshToken: string) {
    const { session, refreshToken: next } = await this.sessions.rotate(refreshToken);
    const tokens = await this.sessions.issueAccessToken(session.userId, session.id);
    return { body: tokens, refreshToken: next };
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return;
    const session = await this.sessions.revokeByToken(refreshToken);
    if (session) await this.activity.record(session.userId, 'auth', 'Signed out', this.where(session));
  }

  /**
   * Always 202, whether or not the email exists. Create a PasswordResetToken
   * (store sha256 of a randomToken(), 30 min expiry) and email the link.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || user.deactivatedAt) {
      return;
    }

    const token = this.crypto.randomToken();
    const tokenHash = this.crypto.sha256(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);

    // Only the newest link works: requesting another one cancels the earlier ones.
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: now },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      }),
    ]);

    await this.mail.sendPasswordResetLink({
      to: user.email,
      name: user.name,
      token,
    });
  }

  /**
   * Validate the token, set the new password (same rules as register), mark the
   * token used, revoke every session, and record an `auth` activity event.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = this.crypto.sha256(dto.token);
    const resetToken = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { deactivatedAt: true } } },
    });

    const now = new Date();
    const invalidLink = () => AppException.validation({ token: 'Invalid or expired password reset link' });
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= now || resetToken.user.deactivatedAt) {
      throw invalidLink();
    }

    if (isBreachedPassword(dto.newPassword)) {
      throw AppException.validation({ newPassword: 'This password is too common. Choose another.' });
    }

    const passwordHash = await this.crypto.hashSecret(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      // Claim the token first; a concurrent reset with the same token gets count 0.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: resetToken.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count === 0) throw invalidLink();

      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      });
      await tx.session.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.activity.record(resetToken.userId, 'auth', 'Password reset', {}, tx);
    });
  }

  private where(session: { deviceName: string; location: string | null }) {
    return { device: session.deviceName, location: session.location };
  }

  private getDummyHash() {
    this.dummyHash ??= this.crypto.hashSecret(this.crypto.randomToken());
    return this.dummyHash;
  }

  private async uniqueKarevoId(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = this.crypto.karevoId();
      const taken = await this.prisma.user.findUnique({ where: { karevoId: id }, select: { id: true } });
      if (!taken) return id;
    }
    throw new Error('Could not allocate a unique Karevo ID');
  }
}
