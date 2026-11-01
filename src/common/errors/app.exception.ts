import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from './error-codes';

export type FieldErrors = Record<string, string>;

/** Throw this from services; the global filter renders it as the standard error shape. */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: FieldErrors,
  ) {
    super(message, status);
  }

  static invalidCredentials() {
    return new AppException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.INVALID_CREDENTIALS,
      'The email, password or NIN you entered is incorrect.',
    );
  }

  static unauthenticated(message = 'Sign in to continue.') {
    return new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.UNAUTHENTICATED, message);
  }

  static tokenExpired() {
    return new AppException(HttpStatus.UNAUTHORIZED, ErrorCode.TOKEN_EXPIRED, 'Your session token has expired.');
  }

  static notFound(what = 'Resource') {
    return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, `${what} not found.`);
  }

  static conflict(message: string) {
    return new AppException(HttpStatus.CONFLICT, ErrorCode.CONFLICT, message);
  }

  static validation(fields: FieldErrors) {
    const first = Object.values(fields)[0] ?? 'Invalid request.';
    return new AppException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_FAILED, first, fields);
  }

  /**
   * Placeholder for scaffolded endpoints. `ref` points the implementer at the
   * module README section that describes the behaviour.
   */
  static notImplemented(ref: string) {
    return new AppException(
      HttpStatus.NOT_IMPLEMENTED,
      ErrorCode.NOT_IMPLEMENTED,
      `Not implemented yet. See ${ref}.`,
    );
  }
}
