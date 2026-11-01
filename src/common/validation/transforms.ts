import { Transform } from 'class-transformer';

/** Emails are compared case-insensitively, so they are stored lower-cased. */
export const NormalizeEmail = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

export const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
