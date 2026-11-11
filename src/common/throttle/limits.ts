// Per-route limits from the spec's "Rate limits" requirement. Use with @Throttle().
const MINUTE = 60_000;

export const LIMITS = {
  default: { default: { limit: 120, ttl: MINUTE } },
  login: { default: { limit: 5, ttl: 15 * MINUTE } },
  register: { default: { limit: 10, ttl: 60 * MINUTE } },
  passwordReset: { default: { limit: 5, ttl: 60 * MINUTE } },
  pin: { default: { limit: 10, ttl: 15 * MINUTE } },
  /** Routes that check a password or 2FA code for a signed-in user. */
  accountSecurity: { default: { limit: 10, ttl: 15 * MINUTE } },
  /** Organisation patient lookups and visit QR redemption: slows enumeration of Karevo IDs. */
  patientLookup: { default: { limit: 60, ttl: 15 * MINUTE } },
  /** Admin audit searches (admin spec §6: monitor bulk searching). */
  adminAudit: { default: { limit: 60, ttl: 15 * MINUTE } },
  shareTokenCreate: { default: { limit: 20, ttl: 60 * MINUTE } },
};
