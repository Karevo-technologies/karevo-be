import { Body, Controller, Get, Header, HttpCode, HttpStatus, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/auth/decorators';
import { RequestUser } from '../../common/auth/request-user';
import { UserView } from '../../common/presenters/user.presenter';
import { LIMITS } from '../../common/throttle/limits';
import { AccountService } from './account.service';
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

@ApiTags('Account')
@ApiBearerAuth()
@Controller('me')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get()
  getMe(@CurrentUser() me: RequestUser): Promise<UserView> {
    return this.account.getMe(me);
  }

  @Patch()
  updateMe(@CurrentUser() me: RequestUser, @Body() dto: UpdateMeDto): Promise<UserView> {
    return this.account.updateMe(me, dto);
  }

  @Put('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(LIMITS.accountSecurity)
  changePassword(@CurrentUser() me: RequestUser, @Body() dto: ChangePasswordDto): Promise<void> {
    return this.account.changePassword(me, dto);
  }

  @Put('pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(LIMITS.pin)
  setPin(@CurrentUser() me: RequestUser, @Body() dto: SetPinDto): Promise<void> {
    return this.account.setPin(me, dto);
  }

  @Post('pin/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(LIMITS.pin)
  verifyPin(@CurrentUser() me: RequestUser, @Body() dto: VerifyPinDto): Promise<void> {
    return this.account.verifyPin(me, dto);
  }

  @Put('2fa')
  @Throttle(LIMITS.accountSecurity)
  setTwoFactor(@CurrentUser() me: RequestUser, @Body() dto: SetTwoFactorDto): Promise<TwoFactorSetupResponse> {
    return this.account.setTwoFactor(me, dto);
  }

  @Post('2fa/confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle(LIMITS.accountSecurity)
  confirmTwoFactor(@CurrentUser() me: RequestUser, @Body() dto: ConfirmTwoFactorDto): Promise<TwoFactorSetupResponse> {
    return this.account.confirmTwoFactor(me, dto);
  }

  @Post('deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(LIMITS.accountSecurity)
  deactivate(@CurrentUser() me: RequestUser, @Body() dto: DeactivateDto): Promise<void> {
    return this.account.deactivate(me, dto);
  }

  @Post('export')
  @HttpCode(HttpStatus.ACCEPTED)
  requestExport(@CurrentUser() me: RequestUser): Promise<{ jobId: string }> {
    return this.account.requestExport(me);
  }

  @Get('summary')
  getSummary(@CurrentUser() me: RequestUser): Promise<SummaryResponse> {
    return this.account.getSummary(me);
  }

  @Get('id-card')
  @Header('Cache-Control', 'no-store')
  getIdCard(@CurrentUser() me: RequestUser): Promise<IdCardResponse> {
    return this.account.getIdCard(me);
  }
}
