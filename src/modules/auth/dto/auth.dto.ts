import { IsEmail, IsJWT, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { UserView } from '../../../common/presenters/user.presenter';
import {
  NIN_MESSAGE,
  NIN_REGEX,
  PASSWORD_MESSAGE,
  PASSWORD_MIN,
} from '../../../common/validation/rules';
import { NormalizeEmail, Trim } from '../../../common/validation/transforms';

export class RegisterDto {
  @Trim()
  @IsString()
  @Length(2, 100)
  name: string;

  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email: string;

  /** 11-digit National Identification Number */
  @Matches(NIN_REGEX, { message: NIN_MESSAGE })
  nin: string;

  @IsString()
  @MinLength(PASSWORD_MIN, { message: PASSWORD_MESSAGE })
  @MaxLength(128)
  password: string;
}

export class LoginDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;

  @Matches(NIN_REGEX, { message: NIN_MESSAGE })
  nin: string;
}

export class TwoFactorVerifyDto {
  /** `challengeToken` from the login response */
  @IsJWT()
  challengeToken: string;

  /** 6-digit TOTP code */
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code: string;
}

export class ForgotPasswordDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @Length(20, 200)
  token: string;

  @IsString()
  @MinLength(PASSWORD_MIN, { message: PASSWORD_MESSAGE })
  @MaxLength(128)
  newPassword: string;
}

export interface AccessTokenResponse {
  accessToken: string;
  expiresIn: number;
}

export interface AuthResponse extends AccessTokenResponse {
  user: UserView;
}

/** Login returns this instead of tokens when 2FA is on; finish with POST /auth/2fa/verify. */
export interface TwoFactorChallengeResponse {
  twoFactorRequired: true;
  challengeToken: string;
}
