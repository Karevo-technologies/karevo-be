import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { OrgAuthController } from './org-auth.controller';
import { OrgAuthGuard } from './org-auth.guard';
import { OrgAuthService } from './org-auth.service';
import { OrgController, OrgPatientsController } from './org.controller';
import { OrgInvitesService } from './org-invites.service';
import { OrgPatientsService } from './org-patients.service';
import { OrgService } from './org.service';
import { OrgSessionService } from './org-session.service';

/** The organisation dashboard's API under /api/v1/org (karevo-doctors-dashboard). */
@Module({
  controllers: [OrgAuthController, OrgController, OrgPatientsController],
  providers: [
    OrgAuthService,
    OrgService,
    OrgPatientsService,
    OrgSessionService,
    OrgInvitesService,
    { provide: APP_GUARD, useClass: OrgAuthGuard },
  ],
  // The admin module invites an organisation's first admin and revokes sessions on suspension.
  exports: [OrgInvitesService, OrgSessionService],
})
export class OrgModule {}
