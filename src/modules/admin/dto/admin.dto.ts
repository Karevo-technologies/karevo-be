import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsJWT,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AccessVia, AdminRole, ConsentStatus, NinStatus, OrgKind, OrgStatus, ShareCategory } from '@prisma/client';
import { CursorQueryDto } from '../../../common/pagination/pagination';
import { NormalizeEmail, Trim } from '../../../common/validation/transforms';
import { KAREVO_ID_REGEX } from '../../org/dto/org.dto';
import { REASON_CODES, ReasonCode } from '../admin-context';

// ---------- auth ----------

export class AdminLoginDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

export class AdminTwoFactorDto {
  @IsJWT()
  challengeToken: string;

  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code: string;
}

/** Sign-in step 1 result. MFA is always required; on first sign-in it must be set up. */
export interface AdminChallengeResponse {
  mfaRequired: true;
  /** True on first sign-in: show `setupUri` as a QR for the authenticator app. */
  mfaSetupRequired: boolean;
  setupUri?: string;
  challengeToken: string;
}

export interface AdminView {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}

export interface AdminAuthResponse {
  accessToken: string;
  expiresIn: number;
  admin: AdminView;
}

// ---------- reasons ----------

/** Every state-changing admin action carries a reason code (admin spec §6). */
export class ReasonDto {
  @IsIn(REASON_CODES)
  reasonCode: ReasonCode;

  @ValidateIf((o: ReasonDto) => o.reasonCode === 'other' || o.note !== undefined)
  @Trim()
  @IsString()
  @Length(3, 1000, { message: 'Add a note (at least 3 characters) when the reason is "other"' })
  note?: string;
}

// ---------- organisations ----------

export class FirstOrgAdminDto {
  @Trim() @IsString() @Length(2, 100) name: string;
  @NormalizeEmail() @IsEmail({}, { message: 'Enter a valid email address' }) email: string;
}

export class CreateOrgDto extends ReasonDto {
  @Trim() @IsString() @Length(2, 150) name: string;
  @IsEnum(OrgKind) kind: OrgKind;
  @IsOptional() @Trim() @IsString() @MaxLength(50) cacNumber?: string;
  @IsOptional() @NormalizeEmail() @IsEmail() email?: string;
  @IsOptional() @Trim() @Matches(/^\+?[0-9 ()-]{7,20}$/, { message: 'Enter a valid phone number' }) phone?: string;
  @IsOptional() @Trim() @IsString() @Length(2, 100) authorisedPerson?: string;

  /** Invited as the organisation's first admin */
  @ValidateNested()
  @Type(() => FirstOrgAdminDto)
  firstAdmin: FirstOrgAdminDto;
}

export class InviteOrgAdminDto extends ReasonDto {
  @Trim() @IsString() @Length(2, 100) name: string;
  @NormalizeEmail() @IsEmail({}, { message: 'Enter a valid email address' }) email: string;
}

export class ListOrgsQueryDto extends CursorQueryDto {
  @IsOptional() @IsEnum(OrgStatus) status?: OrgStatus;
  /** Name contains */
  @IsOptional() @Trim() @IsString() @MaxLength(100) q?: string;
}

export const ORG_TRANSITIONS = ['approve', 'reject', 'suspend', 'reinstate'] as const;
export type OrgTransition = (typeof ORG_TRANSITIONS)[number];

export interface AdminOrgView {
  id: string;
  name: string;
  kind: OrgKind;
  status: OrgStatus;
  statusReason: string | null;
  cacNumber: string | null;
  email: string | null;
  phone: string | null;
  authorisedPerson: string | null;
  memberCount: number;
  createdAt: string;
}

export interface AdminOrgDetailView extends AdminOrgView {
  members: { id: string; name: string; email: string; role: string; status: string; activatedAt: string | null }[];
  stats: { pendingRequests: number; activeConsents: number; recordsIssued: number; recordAccesses30d: number };
}

// ---------- patients ----------

export class NinDecisionDto extends ReasonDto {
  @IsIn(['verified', 'failed'])
  decision: Extract<NinStatus, 'verified' | 'failed'>;
}

/** Account metadata only: no record contents and no full NIN (admin spec §3, ops role). */
export interface AdminUserView {
  id: string;
  karevoId: string;
  name: string;
  emailMasked: string;
  ninMasked: string;
  ninStatus: NinStatus;
  twoFactorEnabled: boolean;
  createdAt: string;
  deactivatedAt: string | null;
  counts: { records: number; pendingConsents: number; activeConsents: number };
}

// ---------- oversight ----------

export class ListAdminConsentsQueryDto extends CursorQueryDto {
  @IsOptional() @IsEnum(ConsentStatus) status?: ConsentStatus;
  @IsOptional() @IsUUID() orgId?: string;
  @IsOptional() @Trim() @Matches(KAREVO_ID_REGEX) karevoId?: string;
}

export interface AdminConsentView {
  id: string;
  patient: { karevoId: string };
  org: { id: string; name: string };
  scope: ShareCategory[];
  purpose: string;
  status: ConsentStatus;
  requestedAt: string;
  resolvedAt: string | null;
  expiresAt: string | null;
  /** Patient's reason when declining or revoking */
  note: string | null;
}

export class RecordAccessQueryDto extends CursorQueryDto {
  @IsOptional() @Trim() @Matches(KAREVO_ID_REGEX) karevoId?: string;
  @IsOptional() @IsUUID() orgId?: string;
  @IsOptional() @IsEnum(AccessVia) via?: AccessVia;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export interface RecordAccessView {
  id: string;
  patient: { karevoId: string };
  record: { id: string; type: string };
  org: { id: string; name: string } | null;
  member: { id: string; name: string } | null;
  admin: { id: string; name: string } | null;
  via: AccessVia;
  consentId: string | null;
  visitGrantId: string | null;
  reasonCode: string | null;
  accessedAt: string;
}

export class AdminActionsQueryDto extends CursorQueryDto {
  @IsOptional() @IsUUID() adminId?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(60) action?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(40) targetType?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(60) targetId?: string;
}

export interface AdminActionView {
  id: string;
  admin: { id: string; name: string; role: AdminRole };
  action: string;
  targetType: string;
  targetId: string;
  reasonCode: string;
  note: string | null;
  occurredAt: string;
}

export interface OverviewView {
  orgs: Record<OrgStatus, number>;
  activeOrgMembers: number;
  patients: { total: number; ninVerified: number };
  records: number;
  consents: { pending: number; active: number };
  recordAccesses: { last7d: number; last30d: number };
  generatedAt: string;
}
