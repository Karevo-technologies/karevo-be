import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ActivityKind, LinkedIdStatus, LinkedIdType } from '@prisma/client';
import { CursorQueryDto } from '../../../common/pagination/pagination';

/** Any subset of Preferences. */
export class UpdatePreferencesDto {
  @IsOptional() @IsBoolean() notifyEmail?: boolean;
  @IsOptional() @IsBoolean() notifySms?: boolean;
  @IsOptional() @IsBoolean() notifyPush?: boolean;

  /** 0 turns the idle limit off */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(240)
  autoSignOutMinutes?: number;

  @IsOptional() @IsBoolean() offlineEnabled?: boolean;
  @IsOptional() @IsBoolean() offlineCardOnly?: boolean;
}

export class RevokeSessionsQueryDto {
  /** Only `current` is supported: sign out every other session */
  @IsIn(['current'])
  except: 'current';
}

export class ListActivityQueryDto extends CursorQueryDto {
  @IsOptional()
  @IsEnum(ActivityKind)
  kind?: ActivityKind;
}

export interface PreferencesView {
  notifyEmail: boolean;
  notifySms: boolean;
  notifyPush: boolean;
  autoSignOutMinutes: number;
  offlineEnabled: boolean;
  offlineCardOnly: boolean;
}

export interface LinkedIdView {
  id: string;
  type: LinkedIdType;
  numberMasked: string;
  status: LinkedIdStatus;
}

export interface SessionView {
  id: string;
  deviceName: string;
  detail: string;
  location: string | null;
  lastActiveAt: string;
  current: boolean;
}

export interface ActivityView {
  id: string;
  kind: ActivityKind;
  event: string;
  device: string | null;
  location: string | null;
  occurredAt: string;
}

export interface IntegrityView {
  score: number;
  factors: { key: string; label: string; ok: boolean }[];
}
