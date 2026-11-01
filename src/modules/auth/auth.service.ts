import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ActivityService } from '../../activity/activity.service';
import { AppException } from '../../common/errors/app.exception';
import { toUserView } from '../../common/presenters/user.presenter';
import { notImplemented } from '../../common/stub';
import { CryptoService } from '../../crypto/crypto.service';
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
  async verifyTwoFactor(_dto: TwoFactorVerifyDto, _client: ClientContext): Promise<{ body: AuthResponse; refreshToken: string }> {
    return notImplemented('src/modules/auth/README.md#2fa');
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
  async forgotPassword(_dto: ForgotPasswordDto): Promise<void> {
    return notImplemented('src/modules/auth/README.md#password-reset');
  }

  /**
   * Validate the token, set the new password (same rules as register), mark the
   * token used, revoke every session, and record an `auth` activity event.
   */
  async resetPassword(_dto: ResetPasswordDto): Promise<void> {
    return notImplemented('src/modules/auth/README.md#password-reset');
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
