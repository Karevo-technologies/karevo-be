import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { OrgKind, ShareCategory, ShareExpiry } from '@prisma/client';
import { CursorQueryDto } from '../../../common/pagination/pagination';
import { Trim } from '../../../common/validation/transforms';

/**
 * Wire values for `expiry`. Prisma enum keys cannot start with a digit, so the
 * DB enum keys differ (h1, h24, d7) while the stored values match the API.
 */
export const EXPIRY_VALUES = ['1h', '24h', '7d', 'single'] as const;
export type ExpiryValue = (typeof EXPIRY_VALUES)[number];

export const EXPIRY_TO_DB: Record<ExpiryValue, ShareExpiry> = {
  '1h': ShareExpiry.h1,
  '24h': ShareExpiry.h24,
  '7d': ShareExpiry.d7,
  single: ShareExpiry.single,
};

export const EXPIRY_FROM_DB: Record<ShareExpiry, ExpiryValue> = {
  h1: '1h',
  h24: '24h',
  d7: '7d',
  single: 'single',
};

export class CreateShareTokenDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Choose at least one category to share' })
  @ArrayUnique()
  @IsEnum(ShareCategory, { each: true })
  categories: ShareCategory[];

  @IsIn(EXPIRY_VALUES)
  expiry: ExpiryValue;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(60)
  label?: string;
}

export class ListShareTokensQueryDto extends CursorQueryDto {
  /** true: only tokens that are not revoked, used or expired */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  active?: boolean;
}

export class ResolveScanDto {
  /** Raw string decoded from the organisation's QR code */
  @IsString()
  @MaxLength(2048)
  payload: string;
}

export class ConfirmScanDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(ShareCategory, { each: true })
  categories: ShareCategory[];
}

export interface ShareTokenView {
  id: string;
  /** Plain code: present only in the POST /share-tokens response */
  code?: string;
  label: string | null;
  categories: ShareCategory[];
  expiry: ExpiryValue;
  expiresAt: string | null;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface ScanResolveResponse {
  org: { id: string; name: string; kind: OrgKind; verified: boolean };
  requestedCategories: ShareCategory[];
  requestId: string;
}

export interface VisitQrView {
  /** Encode this string as the QR the organisation scans */
  code: string;
  expiresAt: string;
}
