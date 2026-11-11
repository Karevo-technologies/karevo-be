/**
 * Every `error.code` the API returns. The client branches on these, so they
 * are part of the contract: add new ones, never rename.
 */
export enum ErrorCode {
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  // Not in the spec table; see docs/DECISIONS.md (D-10).
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  NIN_NOT_VERIFIED = 'NIN_NOT_VERIFIED',
  // Organisation realm: the organisation has not been approved by Karevo yet.
  ORG_NOT_VERIFIED = 'ORG_NOT_VERIFIED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  RATE_LIMITED = 'RATE_LIMITED',
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}
