import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Env } from '../../config/env';

// Checked first, without a network call.
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'qwertyuiop', '11111111', '00000000', 'iloveyou', 'abcd1234',
  'admin123', 'welcome1', 'letmein1', 'football', 'baseball', 'sunshine',
  'princess', 'trustno1', 'passw0rd', 'karevo123',
]);

const PWNED_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const PWNED_TIMEOUT_MS = 2000;

/**
 * Breached-password check (docs/DECISIONS.md, D-11). Uses the Have I Been Pwned
 * k-anonymity range API: only the first 5 hex characters of the password's
 * SHA-1 leave the server. If the API is down or slow the check fails open, so
 * an outage never blocks sign-up or a password change.
 */
@Injectable()
export class PasswordPolicyService {
  private readonly logger = new Logger(PasswordPolicyService.name);
  private readonly remoteCheck: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.remoteCheck = config.get('BREACHED_PASSWORD_CHECK', { infer: true });
  }

  async isBreached(password: string): Promise<boolean> {
    if (COMMON_PASSWORDS.has(password.toLowerCase())) return true;
    if (!this.remoteCheck) return false;
    return (await this.isPwned(password)) ?? false;
  }

  /** True or false from the range API, or null when it could not be reached. */
  private async isPwned(password: string): Promise<boolean | null> {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    try {
      const res = await fetch(`${PWNED_RANGE_URL}${prefix}`, {
        // Padding hides how many suffixes the prefix really has; padded rows have count 0.
        headers: { 'Add-Padding': 'true', 'User-Agent': 'karevo-be' },
        signal: AbortSignal.timeout(PWNED_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`Breached-password check unavailable (HTTP ${res.status}); allowing password`);
        return null;
      }
      const body = await res.text();
      return body.split('\n').some((line) => {
        const [hashSuffix, count] = line.trim().split(':');
        return hashSuffix === suffix && Number(count) > 0;
      });
    } catch (err) {
      this.logger.warn(`Breached-password check failed (${(err as Error).name}); allowing password`);
      return null;
    }
  }
}
