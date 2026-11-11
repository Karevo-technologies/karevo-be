import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  ConsentStatus,
  OrgKind,
  OrgMemberStatus,
  OrgRole,
  OrgStatus,
  ShareCategory,
} from '@prisma/client';
import { CursorQueryDto } from '../../../common/pagination/pagination';
import { CONSENT_DAYS, PASSWORD_MESSAGE, PASSWORD_MIN } from '../../../common/validation/rules';
import { NormalizeEmail, Trim } from '../../../common/validation/transforms';

export const KAREVO_ID_REGEX = /^KV-\d{4}-\d{4}$/;

/** Categories a record can be filed under (`full` is a consent scope, not a record category). */
export const RECORD_CATEGORIES = Object.values(ShareCategory).filter((c) => c !== 'full' && c !== 'id');

// ---------- auth ----------

export class AcceptInviteDto {
  @IsString()
  @Length(20, 200)
  token: string;

  @Trim()
  @IsString()
  @Length(2, 100)
  name: string;

  @IsString()
  @MinLength(PASSWORD_MIN, { message: PASSWORD_MESSAGE })
  @MaxLength(128)
  password: string;
}

export class OrgLoginDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

// ---------- organisation profile and team ----------

export class UpdateOrgProfileDto {
  @IsOptional() @Trim() @IsString() @Length(2, 150) name?: string;
  @IsOptional() @IsEnum(OrgKind) kind?: OrgKind;
  @IsOptional() @Trim() @IsString() @MaxLength(50) cacNumber?: string;
  @IsOptional() @NormalizeEmail() @IsEmail() email?: string;
  @IsOptional() @Trim() @Matches(/^\+?[0-9 ()-]{7,20}$/, { message: 'Enter a valid phone number' }) phone?: string;
  @IsOptional() @Trim() @IsString() @Length(2, 100) authorisedPerson?: string;
}

export class InviteMemberDto {
  @Trim()
  @IsString()
  @Length(2, 100)
  name: string;

  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email: string;

  @IsEnum(OrgRole)
  role: OrgRole;
}

// ---------- patients, consent requests, records, visits ----------

export class CreateConsentRequestDto {
  /** Patient's Karevo ID, e.g. KV-2847-9931 */
  @Trim()
  @Matches(KAREVO_ID_REGEX, { message: 'Enter a Karevo ID like KV-1234-5678' })
  karevoId: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one category' })
  @ArrayUnique()
  @IsEnum(ShareCategory, { each: true })
  scope: ShareCategory[];

  @Trim()
  @IsString()
  @Length(5, 500)
  purpose: string;

  @Type(() => Number)
  @IsInt()
  @IsIn(CONSENT_DAYS, { message: 'requestedDays must be one of 7, 30 or 90' })
  requestedDays: number;
}

export const ORG_CONSENT_TABS = ['pending', 'active', 'history'] as const;

export class ListOrgConsentsQueryDto extends CursorQueryDto {
  @IsIn(ORG_CONSENT_TABS)
  status: (typeof ORG_CONSENT_TABS)[number];
}

export class RedeemVisitDto {
  /** The string decoded from the patient's visit QR */
  @Trim()
  @IsString()
  @Length(10, 200)
  code: string;
}

export class UploadRecordDto {
  @Trim() @IsString() @Length(2, 120) title: string;

  /** Display type, e.g. "Blood Test Result" */
  @Trim() @IsString() @Length(2, 100) type: string;

  @IsIn(RECORD_CATEGORIES, { message: `category must be one of ${RECORD_CATEGORIES.join(', ')}` })
  category: ShareCategory;

  /** YYYY-MM-DD */
  @IsDateString({ strict: true })
  issuedDate: string;

  @Trim() @IsString() @Length(2, 500) summary: string;
  @IsString() @Length(1, 10_000) details: string;
  @IsOptional() @IsString() @MaxLength(2_000) notes?: string;
}

// ---------- response shapes ----------

export interface OrgProfileView {
  id: string;
  name: string;
  kind: OrgKind;
  status: OrgStatus;
  cacNumber: string | null;
  email: string | null;
  phone: string | null;
  authorisedPerson: string | null;
  createdAt: string;
}

export interface MemberView {
  id: string;
  name: string;
  email: string;
  role: OrgRole;
  status: OrgMemberStatus;
  createdAt: string;
  activatedAt: string | null;
}

export interface OrgMeView {
  member: MemberView;
  org: OrgProfileView;
}

export interface OrgAuthResponse {
  accessToken: string;
  expiresIn: number;
  me: OrgMeView;
}

export interface InviteResult {
  member: MemberView;
  /**
   * Link the invitee opens to set a password. Returned until email delivery is
   * live, so the inviter can pass it on (docs/DECISIONS.md D-26).
   */
  inviteUrl: string;
}

export interface PatientRef {
  karevoId: string;
  name: string;
}

export interface PatientLookupView extends PatientRef {
  /** Scopes covered by this organisation's active consents */
  activeScopes: ShareCategory[];
  /** End of this organisation's current visit grant, if any */
  visitExpiresAt: string | null;
}

export interface OrgConsentView {
  id: string;
  patient: PatientRef;
  scope: ShareCategory[];
  purpose: string;
  status: ConsentStatus;
  requestedDays: number;
  requestedAt: string;
  requestedBy: { id: string; name: string } | null;
  grantedDays: number | null;
  expiresAt: string | null;
  resolvedAt: string | null;
  /** Patient's note when declining or revoking */
  note: string | null;
}

export interface OrgRecordView {
  id: string;
  title: string | null;
  type: string;
  category: ShareCategory;
  issuedBy: { id: string; name: string };
  issuedDate: string;
  summary: string;
  details: string;
  notes: string | null;
  receivedAt: string;
}

export interface PatientRecordsView {
  patient: PatientRef;
  via: 'consent' | 'visit';
  records: OrgRecordView[];
}

export interface UploadedRecordView {
  id: string;
  title: string | null;
  type: string;
  category: ShareCategory;
  patient: PatientRef;
  uploadedBy: { id: string; name: string } | null;
  issuedDate: string;
  receivedAt: string;
}

export interface VisitView {
  visitId: string;
  patient: PatientRef;
  expiresAt: string;
}

export interface OrgActivityView {
  id: string;
  action: string;
  description: string;
  status: string;
  member: { id: string; name: string } | null;
  occurredAt: string;
}

export interface OrgSummaryView {
  pendingRequests: number;
  activeConsents: number;
  declinedRequests: number;
  recordsUploaded: number;
  activeVisits: number;
}
