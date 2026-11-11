import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OrgModule } from '../org/org.module';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuthController, AdminController } from './admin.controller';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminOrgsService } from './admin-orgs.service';
import { AdminOversightService } from './admin-oversight.service';
import { AdminSessionService } from './admin-session.service';
import { AdminUsersService } from './admin-users.service';

/** The super admin dashboard's API under /api/v1/admin (karevo-admin). */
@Module({
  imports: [OrgModule],
  controllers: [AdminAuthController, AdminController],
  providers: [
    AdminAuthService,
    AdminSessionService,
    AdminAuditService,
    AdminOrgsService,
    AdminUsersService,
    AdminOversightService,
    { provide: APP_GUARD, useClass: AdminAuthGuard },
  ],
})
export class AdminModule {}
