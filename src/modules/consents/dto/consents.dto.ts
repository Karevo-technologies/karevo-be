import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { ConsentStatus, OrgKind, ShareCategory } from '@prisma/client';
import { CursorQueryDto } from '../../../common/pagination/pagination';
import { CONSENT_DAYS } from '../../../common/validation/rules';
import { Trim } from '../../../common/validation/transforms';

/** UI tabs. `history` = declined + revoked + expired. */
export const CONSENT_TABS = ['pending', 'active', 'history'] as const;
export type ConsentTab = (typeof CONSENT_TABS)[number];

export class ListConsentsQueryDto extends CursorQueryDto {
  @IsIn(CONSENT_TABS)
  status: ConsentTab;
}

export class ApproveConsentDto {
  /** May be fewer than the request's `requestedDays` */
  @Type(() => Number)
  @IsInt()
  @IsIn(CONSENT_DAYS, { message: 'days must be one of 7, 30 or 90' })
  days: number;
}

export class ResolveConsentDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export interface ConsentView {
  id: string;
  org: { id: string; name: string; kind: OrgKind; verified: boolean };
  scope: ShareCategory[];
  purpose: string;
  status: ConsentStatus;
  requestedDays: number;
  requestedAt: string;
  grantedDays: number | null;
  grantedAt: string | null;
  expiresAt: string | null;
  resolvedAt: string | null;
  note: string | null;
}
