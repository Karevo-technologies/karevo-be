import { Injectable } from '@nestjs/common';
import { RequestUser } from '../../common/auth/request-user';
import { AppException } from '../../common/errors/app.exception';
import { toUserView, UserView } from '../../common/presenters/user.presenter';
import { notImplemented } from '../../common/stub';
import { PrismaService } from '../../prisma/prisma.service';
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

const README = 'src/modules/account/README.md';

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(me: RequestUser): Promise<UserView> {
    const user = await this.prisma.user.findUnique({ where: { id: me.id } });
    if (!user) throw AppException.notFound('User');
    return toUserView(user);
  }

  updateMe(_me: RequestUser, _dto: UpdateMeDto): Promise<UserView> {
    return notImplemented(`${README}#patch-me`);
  }

  changePassword(_me: RequestUser, _dto: ChangePasswordDto): Promise<void> {
    return notImplemented(`${README}#password`);
  }

  setPin(_me: RequestUser, _dto: SetPinDto): Promise<void> {
    return notImplemented(`${README}#pin`);
  }

  verifyPin(_me: RequestUser, _dto: VerifyPinDto): Promise<void> {
    return notImplemented(`${README}#pin`);
  }

  setTwoFactor(_me: RequestUser, _dto: SetTwoFactorDto): Promise<TwoFactorSetupResponse> {
    return notImplemented(`${README}#2fa`);
  }

  confirmTwoFactor(_me: RequestUser, _dto: ConfirmTwoFactorDto): Promise<TwoFactorSetupResponse> {
    return notImplemented(`${README}#2fa`);
  }

  deactivate(_me: RequestUser, _dto: DeactivateDto): Promise<void> {
    return notImplemented(`${README}#deactivate`);
  }

  requestExport(_me: RequestUser): Promise<{ jobId: string }> {
    return notImplemented(`${README}#export`);
  }

  getSummary(_me: RequestUser): Promise<SummaryResponse> {
    return notImplemented(`${README}#summary`);
  }

  getIdCard(_me: RequestUser): Promise<IdCardResponse> {
    return notImplemented(`${README}#id-card`);
  }
}
