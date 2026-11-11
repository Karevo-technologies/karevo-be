import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from '../../common/auth/decorators';
import { UseRealm } from '../../common/auth/realm';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import {
  clearRealmCookie,
  isTrustedOrigin,
  ORG_COOKIE,
  readRealmCookie,
  setRealmCookie,
} from '../../common/sessions/realm-cookie';
import { LIMITS } from '../../common/throttle/limits';
import { Env } from '../../config/env';
import { clientContext } from '../auth/device';
import { AcceptInviteDto, OrgAuthResponse, OrgLoginDto } from './dto/org.dto';
import { ORG_SESSION } from './org-context';
import { OrgAuthService } from './org-auth.service';

@ApiTags('Org · Auth')
@UseRealm('org')
@Public()
@Controller('org/auth')
export class OrgAuthController {
  private readonly cookieSecure: boolean;
  private readonly allowedOrigins: string[];

  constructor(
    private readonly auth: OrgAuthService,
    config: ConfigService<Env, true>,
  ) {
    this.cookieSecure = config.get('COOKIE_SECURE', { infer: true });
    this.allowedOrigins = config.get('CORS_ORIGINS', { infer: true });
  }

  @Post('invite/accept')
  @HttpCode(HttpStatus.OK)
  @Throttle(LIMITS.register)
  async acceptInvite(
    @Body() dto: AcceptInviteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrgAuthResponse> {
    const { body, refreshToken } = await this.auth.acceptInvite(dto, clientContext(req));
    setRealmCookie(res, ORG_COOKIE, refreshToken, this.cookieSecure, ORG_SESSION.refreshTtlMs);
    return body;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(LIMITS.login)
  async login(
    @Body() dto: OrgLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OrgAuthResponse> {
    const { body, refreshToken } = await this.auth.login(dto, clientContext(req));
    setRealmCookie(res, ORG_COOKIE, refreshToken, this.cookieSecure, ORG_SESSION.refreshTtlMs);
    return body;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertTrustedOrigin(req);
    const token = readRealmCookie(req, ORG_COOKIE);
    if (!token) throw AppException.unauthenticated();
    try {
      const { body, refreshToken } = await this.auth.refresh(token);
      setRealmCookie(res, ORG_COOKIE, refreshToken, this.cookieSecure, ORG_SESSION.refreshTtlMs);
      return body;
    } catch (err) {
      clearRealmCookie(res, ORG_COOKIE, this.cookieSecure);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    this.assertTrustedOrigin(req);
    await this.auth.logout(readRealmCookie(req, ORG_COOKIE));
    clearRealmCookie(res, ORG_COOKIE, this.cookieSecure);
  }

  private assertTrustedOrigin(req: Request) {
    if (!isTrustedOrigin(req, this.allowedOrigins)) {
      throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'Request origin not allowed.');
    }
  }
}
