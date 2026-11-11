import { HttpStatus, Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { ActivityService } from '../../activity/activity.service';
import { RequestUser } from '../../common/auth/request-user';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { toUserView, UserView } from '../../common/presenters/user.presenter';
import { isTrivialPin } from '../../common/validation/rules';
import { CryptoService } from '../../crypto/crypto.service';
import { generateTotpSecret } from '../../crypto/totp';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordPolicyService } from '../auth/password-policy';
import { consumeTotpCode } from '../auth/two-factor';
import {
  ChangePasswordDto,
  ConfirmTwoFactorDto,
  DeactivateDto,
  IdCardResponse,
  SetPinDto,
  SetTwoFactorDto,
  SummaryResponse,
  TwoFactorSetupResponse,
  UpdateMeDto,
  VerifyPinDto,
} from './dto/account.dto';

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly activity: ActivityService,
    private readonly passwordPolicy: PasswordPolicyService,
  ) {}

  async getMe(me: RequestUser): Promise<UserView> {
    const user = await this.prisma.user.findUnique({ where: { id: me.id } });
    if (!user) throw AppException.notFound('User');
    return toUserView(user);
  }

  async updateMe(me: RequestUser, dto: UpdateMeDto): Promise<UserView> {
    const user = await this.prisma.user.update({
      where: { id: me.id },
      data: { name: dto.name },
    });
    await this.activity.record(me.id, 'auth', 'Profile updated');
    return toUserView(user);
  }

  async changePassword(me: RequestUser, dto: ChangePasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: me.id } });
    if (!user) throw AppException.notFound('User');

    const passwordOk = await this.crypto.verifySecret(user.passwordHash, dto.currentPassword);
    if (!passwordOk) {
      throw AppException.validation({ currentPassword: 'Incorrect current password' });
    }

    if (await this.passwordPolicy.isBreached(dto.newPassword)) {
      throw AppException.validation({ newPassword: 'This password is too common. Choose another.' });
    }

    const passwordHash = await this.crypto.hashSecret(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: me.id },
        data: { passwordHash },
      });
      await tx.session.updateMany({
        where: { userId: me.id, id: { not: me.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.activity.record(me.id, 'auth', 'Password changed', {}, tx);
    });
  }

  async setPin(me: RequestUser, dto: SetPinDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: me.id } });
    if (!user) throw AppException.notFound('User');

    if (user.pinHash) {
      if (!dto.currentPin) {
        throw AppException.validation({ currentPin: 'Current PIN is required' });
      }
      const pinOk = await this.crypto.verifySecret(user.pinHash, dto.currentPin);
      if (!pinOk) {
        throw AppException.validation({ currentPin: 'Incorrect current PIN' });
      }
    } else {
      if (!dto.password) {
        throw AppException.validation({ password: 'Password is required to set initial PIN' });
      }
      const passwordOk = await this.crypto.verifySecret(user.passwordHash, dto.password);
      if (!passwordOk) {
        throw AppException.validation({ password: 'Incorrect password' });
      }
    }

    if (isTrivialPin(dto.newPin)) {
      throw AppException.validation({ newPin: 'This PIN is too easy to guess. Choose another.' });
    }

    const pinHash = await this.crypto.hashSecret(dto.newPin);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: me.id },
        data: { pinHash, pinFailedCount: 0, pinLockedUntil: null },
      });
      await this.activity.record(me.id, 'auth', 'PIN changed', {}, tx);
    });
  }

  async verifyPin(me: RequestUser, dto: VerifyPinDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: me.id } });
    if (!user || !user.pinHash) {
      throw AppException.validation({ pin: 'PIN is not set' });
    }

    const now = new Date();
    if (user.pinLockedUntil && user.pinLockedUntil > now) {
      throw new AppException(
        HttpStatus.LOCKED,
        ErrorCode.ACCOUNT_LOCKED,
        'PIN verification is temporarily locked due to too many failed attempts.',
      );
    }

    const pinOk = await this.crypto.verifySecret(user.pinHash, dto.pin);
    if (!pinOk) {
      // Increment in the database so concurrent wrong guesses are all counted.
      const { pinFailedCount: failedCount } = await this.prisma.user.update({
        where: { id: me.id },
        data: { pinFailedCount: { increment: 1 } },
        select: { pinFailedCount: true },
      });
      if (failedCount >= 5) {
        const lockUntil = new Date(Date.now() + 15 * 60 * 1000);
        await this.prisma.user.update({
          where: { id: me.id },
          data: { pinFailedCount: 0, pinLockedUntil: lockUntil },
        });
        await this.activity.record(me.id, 'auth', 'PIN locked after 5 failed attempts');
        throw new AppException(
          HttpStatus.LOCKED,
          ErrorCode.ACCOUNT_LOCKED,
          'PIN verification is locked for 15 minutes after 5 failed attempts.',
        );
      }

      throw AppException.validation({ pin: 'Incorrect PIN' });
    }

    if (user.pinFailedCount > 0) {
      await this.prisma.user.update({
        where: { id: me.id },
        data: { pinFailedCount: 0 },
      });
    }
  }

  async setTwoFactor(me: RequestUser, dto: SetTwoFactorDto): Promise<TwoFactorSetupResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: me.id } });
    if (!user) throw AppException.notFound('User');

    if (dto.enabled) {
      // Replacing the secret while 2FA is on would stop the user's authenticator matching.
      if (user.twoFactorEnabled) {
        throw AppException.conflict('Two-factor authentication is already enabled.');
      }
      const secret = generateTotpSecret();
      const twoFactorSecretEnc = this.crypto.encrypt(secret);
      await this.prisma.user.update({
        where: { id: me.id },
        data: { twoFactorSecretEnc, twoFactorLastStep: null },
      });
      const setupUri = `otpauth://totp/Karevo:${encodeURIComponent(user.email)}?secret=${secret}&issuer=Karevo`;
      return { enabled: false, setupUri };
    }

    // Cancelling an unconfirmed setup needs no proof; turning off active 2FA does.
    if (user.twoFactorEnabled) {
      await this.assertCanDisableTwoFactor(user, dto);
    }
    await this.prisma.user.update({
      where: { id: me.id },
      data: { twoFactorEnabled: false, twoFactorSecretEnc: null, twoFactorLastStep: null },
    });
    if (user.twoFactorEnabled) await this.activity.record(me.id, 'auth', '2FA disabled');
    return { enabled: false };
  }

  private async assertCanDisableTwoFactor(user: User, dto: SetTwoFactorDto): Promise<void> {
    if (dto.password) {
      if (await this.crypto.verifySecret(user.passwordHash, dto.password)) return;
      throw AppException.validation({ password: 'Incorrect password' });
    }
    if (dto.code && user.twoFactorSecretEnc) {
      const secret = this.crypto.decrypt(user.twoFactorSecretEnc);
      if (await consumeTotpCode(this.prisma, user, secret, dto.code)) return;
      throw AppException.validation({ code: 'Invalid verification code.' });
    }
    throw AppException.validation({ password: 'Enter your password or a current code to turn off 2FA.' });
  }

  async confirmTwoFactor(me: RequestUser, dto: ConfirmTwoFactorDto): Promise<TwoFactorSetupResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: me.id } });
    if (!user || !user.twoFactorSecretEnc || user.twoFactorEnabled) {
      throw AppException.validation({ code: 'No pending 2FA setup found.' });
    }

    const secret = this.crypto.decrypt(user.twoFactorSecretEnc);
    const codeOk = await consumeTotpCode(this.prisma, user, secret, dto.code);
    if (!codeOk) {
      throw AppException.validation({ code: 'Invalid verification code.' });
    }

    await this.prisma.user.update({
      where: { id: me.id },
      data: { twoFactorEnabled: true },
    });
    await this.activity.record(me.id, 'auth', '2FA enabled');
    return { enabled: true };
  }

  async deactivate(me: RequestUser, dto: DeactivateDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: me.id } });
    if (!user) throw AppException.notFound('User');

    const passwordOk = await this.crypto.verifySecret(user.passwordHash, dto.password);
    if (!passwordOk) {
      throw AppException.validation({ password: 'Incorrect password' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: me.id },
        data: { deactivatedAt: new Date() },
      });
      await tx.session.updateMany({
        where: { userId: me.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.activity.record(me.id, 'auth', 'Account deactivated', {}, tx);
    });
  }

  async requestExport(me: RequestUser): Promise<{ jobId: string }> {
    return this.prisma.$transaction(async (tx) => {
      // Lock the user row so two concurrent requests cannot both queue a job.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${me.id}::uuid FOR UPDATE`;

      const activeJob = await tx.dataExportJob.findFirst({
        where: { userId: me.id, status: { in: ['queued', 'processing'] } },
      });
      if (activeJob) {
        throw AppException.conflict('An export is already in progress.');
      }

      const job = await tx.dataExportJob.create({
        data: { userId: me.id, status: 'queued' },
      });
      return { jobId: job.id };
    });
  }

  async getSummary(me: RequestUser): Promise<SummaryResponse> {
    const now = new Date();
    const [totalRecords, pendingRequests, activeConsents, declined] = await Promise.all([
      this.prisma.healthRecord.count({ where: { userId: me.id } }),
      this.prisma.consentRequest.count({ where: { userId: me.id, status: 'pending' } }),
      this.prisma.consentRequest.count({
        where: { userId: me.id, status: 'active', expiresAt: { gt: now } },
      }),
      this.prisma.consentRequest.count({ where: { userId: me.id, status: 'declined' } }),
    ]);

    return { totalRecords, pendingRequests, activeConsents, declined };
  }

  async getIdCard(me: RequestUser): Promise<IdCardResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: me.id } });
    if (!user) throw AppException.notFound('User');

    return {
      karevoId: user.karevoId,
      name: user.name,
      nin: this.crypto.decrypt(user.ninEnc),
      ninStatus: user.ninStatus,
    };
  }
}
