import { IsBoolean, IsOptional, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import {
  PASSWORD_MESSAGE,
  PASSWORD_MIN,
  PIN_MESSAGE,
  PIN_REGEX,
} from '../../../common/validation/rules';
import { Trim } from '../../../common/validation/transforms';

export class UpdateMeDto {
  @Trim()
  @IsString()
  @Length(2, 100)
  name: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword: string;

  @IsString()
  @MinLength(PASSWORD_MIN, { message: PASSWORD_MESSAGE })
  @MaxLength(128)
  newPassword: string;
}

export class SetPinDto {
  /** Required when the account already has a PIN; omit to set the first PIN. */
  @IsOptional()
  @Matches(PIN_REGEX, { message: PIN_MESSAGE })
  currentPin?: string;

  /** Required when setting the first PIN instead of `currentPin`. */
  @IsOptional()
  @IsString()
  password?: string;

  @Matches(PIN_REGEX, { message: PIN_MESSAGE })
  newPin: string;
}

export class VerifyPinDto {
  @Matches(PIN_REGEX, { message: PIN_MESSAGE })
  pin: string;
}

export class SetTwoFactorDto {
  @IsBoolean()
  enabled: boolean;

  /** Turning 2FA off needs either the password or a current code. */
  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code?: string;
}

export class ConfirmTwoFactorDto {
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code: string;
}

export class DeactivateDto {
  @IsString()
  @MinLength(1)
  password: string;
}

export interface TwoFactorSetupResponse {
  enabled: boolean;
  /** otpauth:// URI for the QR code, present while setup awaits confirmation */
  setupUri?: string;
}

export interface SummaryResponse {
  totalRecords: number;
  pendingRequests: number;
  activeConsents: number;
  declined: number;
}

export interface IdCardResponse {
  karevoId: string;
  name: string;
  /** Unmasked: the only endpoint that returns the full NIN */
  nin: string;
  ninStatus: string;
}
