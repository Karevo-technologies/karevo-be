import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Public } from '../../common/auth/decorators';
import { UseRealm } from '../../common/auth/realm';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { Page } from '../../common/pagination/pagination';
import {
  ADMIN_COOKIE,
  clearRealmCookie,
  isTrustedOrigin,
  readRealmCookie,
  setRealmCookie,
} from '../../common/sessions/realm-cookie';
import { LIMITS } from '../../common/throttle/limits';
import { Env } from '../../config/env';
import { clientContext } from '../auth/device';
import { ADMIN_SESSION, AdminRoles, ALL_ADMIN_ROLES, CurrentAdmin, RequestAdmin } from './admin-context';
import { AdminAuthService } from './admin-auth.service';
import { AdminOrgsService } from './admin-orgs.service';
import { AdminOversightService } from './admin-oversight.service';
import { AdminUsersService } from './admin-users.service';
import {
  AdminActionsQueryDto,
  AdminActionView,
  AdminAuthResponse,
  AdminChallengeResponse,
  AdminConsentView,
  AdminLoginDto,
  AdminOrgDetailView,
  AdminOrgView,
  AdminTwoFactorDto,
  AdminUserView,
  AdminView,
  CreateOrgDto,
  InviteOrgAdminDto,
  ListAdminConsentsQueryDto,
  ListOrgsQueryDto,
  NinDecisionDto,
  OverviewView,
  ReasonDto,
  RecordAccessQueryDto,
  RecordAccessView,
} from './dto/admin.dto';

@ApiTags('Admin · Auth')
@UseRealm('admin')
@Public()
@Controller('admin/auth')
export class AdminAuthController {
  private readonly cookieSecure: boolean;
  private readonly allowedOrigins: string[];

  constructor(
    private readonly auth: AdminAuthService,
    config: ConfigService<Env, true>,
  ) {
    this.cookieSecure = config.get('COOKIE_SECURE', { infer: true });
    this.allowedOrigins = config.get('CORS_ORIGINS', { infer: true });
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(LIMITS.login)
  login(@Body() dto: AdminLoginDto): Promise<AdminChallengeResponse> {
    return this.auth.login(dto);
  }

  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle(LIMITS.login)
  async verify(
    @Body() dto: AdminTwoFactorDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminAuthResponse> {
    const { body, refreshToken } = await this.auth.verifyTwoFactor(dto, clientContext(req));
    setRealmCookie(res, ADMIN_COOKIE, refreshToken, this.cookieSecure, ADMIN_SESSION.refreshTtlMs);
    return body;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertTrustedOrigin(req);
    const token = readRealmCookie(req, ADMIN_COOKIE);
    if (!token) throw AppException.unauthenticated();
    try {
      const { body, refreshToken } = await this.auth.refresh(token);
      setRealmCookie(res, ADMIN_COOKIE, refreshToken, this.cookieSecure, ADMIN_SESSION.refreshTtlMs);
      return body;
    } catch (err) {
      clearRealmCookie(res, ADMIN_COOKIE, this.cookieSecure);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    this.assertTrustedOrigin(req);
    await this.auth.logout(readRealmCookie(req, ADMIN_COOKIE));
    clearRealmCookie(res, ADMIN_COOKIE, this.cookieSecure);
  }

  private assertTrustedOrigin(req: Request) {
    if (!isTrustedOrigin(req, this.allowedOrigins)) {
      throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'Request origin not allowed.');
    }
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@UseRealm('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly orgs: AdminOrgsService,
    private readonly users: AdminUsersService,
    private readonly oversight: AdminOversightService,
  ) {}

  @Get('me')
  @AdminRoles(...ALL_ADMIN_ROLES)
  me(@CurrentAdmin() admin: RequestAdmin): Promise<AdminView> {
    return this.auth.me(admin.id);
  }

  @Get('overview')
  @AdminRoles(...ALL_ADMIN_ROLES)
  overview(): Promise<OverviewView> {
    return this.oversight.overview();
  }

  // ---------- organisations (§4.2) ----------

  @Post('orgs')
  @AdminRoles('super_admin', 'ops_support')
  createOrg(@CurrentAdmin() admin: RequestAdmin, @Body() dto: CreateOrgDto): Promise<{ org: AdminOrgView; inviteUrl: string }> {
    return this.orgs.create(admin, dto);
  }

  @Get('orgs')
  @AdminRoles('super_admin', 'ops_support')
  listOrgs(@Query() query: ListOrgsQueryDto): Promise<Page<AdminOrgView>> {
    return this.orgs.list(query);
  }

  @Get('orgs/:id')
  @AdminRoles('super_admin', 'ops_support')
  getOrg(@Param('id', ParseUUIDPipe) id: string): Promise<AdminOrgDetailView> {
    return this.orgs.get(id);
  }

  @Post('orgs/:id/approve')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('super_admin', 'ops_support')
  approve(@CurrentAdmin() admin: RequestAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto): Promise<AdminOrgView> {
    return this.orgs.transition(admin, id, 'approve', dto);
  }

  @Post('orgs/:id/reject')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('super_admin', 'ops_support')
  reject(@CurrentAdmin() admin: RequestAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto): Promise<AdminOrgView> {
    return this.orgs.transition(admin, id, 'reject', dto);
  }

  @Post('orgs/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('super_admin', 'ops_support')
  suspend(@CurrentAdmin() admin: RequestAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto): Promise<AdminOrgView> {
    return this.orgs.transition(admin, id, 'suspend', dto);
  }

  @Post('orgs/:id/reinstate')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('super_admin', 'ops_support')
  reinstate(@CurrentAdmin() admin: RequestAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto): Promise<AdminOrgView> {
    return this.orgs.transition(admin, id, 'reinstate', dto);
  }

  @Post('orgs/:id/admins')
  @AdminRoles('super_admin', 'ops_support')
  inviteOrgAdmin(@CurrentAdmin() admin: RequestAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: InviteOrgAdminDto): Promise<{ inviteUrl: string }> {
    return this.orgs.inviteAdmin(admin, id, dto);
  }

  // ---------- patients (§4.3) ----------

  @Get('users/:karevoId')
  @AdminRoles('super_admin', 'ops_support')
  getUser(@CurrentAdmin() admin: RequestAdmin, @Param('karevoId') karevoId: string): Promise<AdminUserView> {
    return this.users.getByKarevoId(admin, karevoId);
  }

  @Post('users/:id/nin')
  @HttpCode(HttpStatus.OK)
  @AdminRoles('super_admin', 'ops_support')
  decideNin(@CurrentAdmin() admin: RequestAdmin, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NinDecisionDto): Promise<AdminUserView> {
    return this.users.decideNin(admin, id, dto);
  }

  // ---------- records, consent and audit (§4.4) ----------

  @Get('consents')
  @AdminRoles('super_admin', 'compliance_officer')
  consents(@Query() query: ListAdminConsentsQueryDto): Promise<Page<AdminConsentView>> {
    return this.oversight.consents(query);
  }

  @Get('audit/record-access')
  @AdminRoles('super_admin', 'compliance_officer')
  @Throttle(LIMITS.adminAudit)
  recordAccess(@Query() query: RecordAccessQueryDto): Promise<Page<RecordAccessView>> {
    return this.oversight.recordAccess(query);
  }

  @Get('audit/admin-actions')
  @AdminRoles('super_admin', 'compliance_officer')
  @Throttle(LIMITS.adminAudit)
  adminActions(@Query() query: AdminActionsQueryDto): Promise<Page<AdminActionView>> {
    return this.oversight.adminActions(query);
  }
}
