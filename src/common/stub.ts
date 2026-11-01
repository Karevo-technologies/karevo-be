import { AppException } from './errors/app.exception';

/**
 * Marks a scaffolded service method. Replace the call with the real logic
 * described at `ref`; grep for `notImplemented(` to see what is left.
 */
export function notImplemented(ref: string): never {
  throw AppException.notImplemented(ref);
}
