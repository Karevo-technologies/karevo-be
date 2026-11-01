import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from '../../common/auth/decorators';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { LIMITS } from '../../common/throttle/limits';
import { Env } from '../../config/env';
import { AuthService } from './auth.service';
import { clientContext } from './device';
import {
  AccessTokenResponse,
  AuthResponse,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  TwoFactorChallengeResponse,
  TwoFactorVerifyDto,
} from './dto/auth.dto';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie';
import { SessionService } from './session.service';

@ApiTags('Auth')
@Public()
@Controller('auth')
export class AuthController {
  private readonly cookieSecure: boolean;
  private readonly allowedOrigins: string[];

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    config: ConfigService<Env, true>,
  ) {
    this.cookieSecure = config.get('COOKIE_SECURE', { infer: true });
    this.allowedOrigins = config.get('CORS_ORIGINS', { infer: true });
  }

  @Post('register')
  @Throttle(LIMITS.register)
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { body, refreshToken } = await this.auth.register(dto, clientContext(req));
    this.setCookie(res, refreshToken);
    return body;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(LIMITS.login)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse | TwoFactorChallengeResponse> {
    const result = await this.auth.login(dto, clientContext(req));
    if (result.kind === 'session') this.setCookie(res, result.refreshToken);
    return result.body;
  }

  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle(LIMITS.login)
  async verifyTwoFactor(
    @Body() dto: TwoFactorVerifyDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { body, refreshToken } = await this.auth.verifyTwoFactor(dto, clientContext(req));
    this.setCookie(res, refreshToken);
    return body;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AccessTokenResponse> {
    this.assertTrustedOrigin(req);
    const token = readRefreshCookie(req);
    if (!token) throw AppException.unauthenticated();
    try {
      const { body, refreshToken } = await this.auth.refresh(token);
      this.setCookie(res, refreshToken);
      return body;
    } catch (err) {
      clearRefreshCookie(res, this.cookieSecure);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    this.assertTrustedOrigin(req);
    await this.auth.logout(readRefreshCookie(req));
    clearRefreshCookie(res, this.cookieSecure);
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle(LIMITS.passwordReset)
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    return this.auth.forgotPassword(dto);
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(LIMITS.passwordReset)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.auth.resetPassword(dto);
  }

  private setCookie(res: Response, refreshToken: string) {
    setRefreshCookie(res, refreshToken, this.cookieSecure, this.sessions.refreshTtlInDays);
  }

  /**
   * CSRF defence for the cookie-authenticated endpoints, on top of
   * SameSite=Strict: a browser request from another origin is refused.
   */
  private assertTrustedOrigin(req: Request) {
    const origin = req.get('origin');
    if (origin && !this.allowedOrigins.includes(origin)) {
      throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'Request origin not allowed.');
    }
  }
}
