import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UseRealm } from '../../common/auth/realm';
import { CursorQueryDto, Page } from '../../common/pagination/pagination';
import { LIMITS } from '../../common/throttle/limits';
import {
  CreateConsentRequestDto,
  InviteMemberDto,
  InviteResult,
  ListOrgConsentsQueryDto,
  MemberView,
  OrgActivityView,
  OrgConsentView,
  OrgMeView,
  OrgProfileView,
  OrgSummaryView,
  PatientLookupView,
  PatientRecordsView,
  RedeemVisitDto,
  UpdateOrgProfileDto,
  UploadedRecordView,
  UploadRecordDto,
  VisitView,
} from './dto/org.dto';
import { CurrentMember, OrgRoles, RequestOrgMember, RequireVerifiedOrg } from './org-context';
import { OrgPatientsService } from './org-patients.service';
import { OrgService } from './org.service';

@ApiTags('Org · Account & team')
@ApiBearerAuth()
@UseRealm('org')
@Controller('org')
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get('me')
  getMe(@CurrentMember() me: RequestOrgMember): Promise<OrgMeView> {
    return this.org.getMe(me);
  }

  @Get('summary')
  getSummary(@CurrentMember() me: RequestOrgMember): Promise<OrgSummaryView> {
    return this.org.getSummary(me);
  }

  @Get('activity')
  listActivity(@CurrentMember() me: RequestOrgMember, @Query() query: CursorQueryDto): Promise<Page<OrgActivityView>> {
    return this.org.listActivity(me, query);
  }

  @Get('profile')
  getProfile(@CurrentMember() me: RequestOrgMember): Promise<OrgProfileView> {
    return this.org.getProfile(me);
  }

  @Patch('profile')
  @OrgRoles('admin')
  updateProfile(@CurrentMember() me: RequestOrgMember, @Body() dto: UpdateOrgProfileDto): Promise<OrgProfileView> {
    return this.org.updateProfile(me, dto);
  }

  @Get('members')
  listMembers(@CurrentMember() me: RequestOrgMember): Promise<MemberView[]> {
    return this.org.listMembers(me);
  }

  @Post('members')
  @OrgRoles('admin')
  inviteMember(@CurrentMember() me: RequestOrgMember, @Body() dto: InviteMemberDto): Promise<InviteResult> {
    return this.org.inviteMember(me, dto);
  }

  @Post('members/:id/invite')
  @HttpCode(HttpStatus.OK)
  @OrgRoles('admin')
  resendInvite(@CurrentMember() me: RequestOrgMember, @Param('id', ParseUUIDPipe) id: string): Promise<InviteResult> {
    return this.org.resendInvite(me, id);
  }

  @Delete('members/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @OrgRoles('admin')
  removeMember(@CurrentMember() me: RequestOrgMember, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.org.removeMember(me, id);
  }
}

/** Patient-facing work. Every route needs the organisation approved by Karevo. */
@ApiTags('Org · Patients & records')
@ApiBearerAuth()
@UseRealm('org')
@RequireVerifiedOrg()
@Controller('org')
export class OrgPatientsController {
  constructor(private readonly patients: OrgPatientsService) {}

  @Get('patients/:karevoId')
  @Throttle(LIMITS.patientLookup)
  lookup(@CurrentMember() me: RequestOrgMember, @Param('karevoId') karevoId: string): Promise<PatientLookupView> {
    return this.patients.lookup(me, karevoId);
  }

  @Get('patients/:karevoId/records')
  patientRecords(@CurrentMember() me: RequestOrgMember, @Param('karevoId') karevoId: string): Promise<PatientRecordsView> {
    return this.patients.patientRecords(me, karevoId);
  }

  @Post('patients/:karevoId/records')
  uploadRecord(
    @CurrentMember() me: RequestOrgMember,
    @Param('karevoId') karevoId: string,
    @Body() dto: UploadRecordDto,
  ): Promise<UploadedRecordView> {
    return this.patients.uploadRecord(me, karevoId, dto);
  }

  @Get('records')
  listUploads(@CurrentMember() me: RequestOrgMember, @Query() query: CursorQueryDto): Promise<Page<UploadedRecordView>> {
    return this.patients.listUploads(me, query);
  }

  @Post('consent-requests')
  createConsentRequest(@CurrentMember() me: RequestOrgMember, @Body() dto: CreateConsentRequestDto): Promise<OrgConsentView> {
    return this.patients.createConsentRequest(me, dto);
  }

  @Get('consent-requests')
  listConsentRequests(@CurrentMember() me: RequestOrgMember, @Query() query: ListOrgConsentsQueryDto): Promise<Page<OrgConsentView>> {
    return this.patients.listConsentRequests(me, query);
  }

  @Get('consent-requests/:id')
  getConsentRequest(@CurrentMember() me: RequestOrgMember, @Param('id', ParseUUIDPipe) id: string): Promise<OrgConsentView> {
    return this.patients.getConsentRequest(me, id);
  }

  @Get('consent-requests/:id/records')
  consentRecords(@CurrentMember() me: RequestOrgMember, @Param('id', ParseUUIDPipe) id: string): Promise<PatientRecordsView> {
    return this.patients.consentRecords(me, id);
  }

  @Post('visits')
  @Throttle(LIMITS.patientLookup)
  redeemVisit(@CurrentMember() me: RequestOrgMember, @Body() dto: RedeemVisitDto): Promise<VisitView> {
    return this.patients.redeemVisit(me, dto);
  }
}
