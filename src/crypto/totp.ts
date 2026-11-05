import { createHmac, randomBytes } from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(bytes = 20): string {
  const buf = randomBytes(bytes);
  let bits = 0;
  let value = 0;
  let output = '';

  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const cleaned = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function currentTotpStep(timeStepSeconds = 30): number {
  return Math.floor(Date.now() / 1000 / timeStepSeconds);
}

export function generateTotpCode(secretBase32: string, timeStepOffset = 0, timeStepSeconds = 30): string {
  const key = base32Decode(secretBase32);
  const step = currentTotpStep(timeStepSeconds) + timeStepOffset;

  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step), 0);

  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 1_000_000;
  return otp.toString().padStart(6, '0');
}

/**
 * Returns the time step the code matches, or null. Store the step after a
 * successful check and refuse steps at or below it, so a code works only once.
 */
export function matchTotpStep(secretBase32: string, code: string, windowSteps = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = currentTotpStep();
  for (let offset = -windowSteps; offset <= windowSteps; offset++) {
    const expected = generateTotpCode(secretBase32, offset);
    if (expected === code) return now + offset;
  }
  return null;
}

export function verifyTotpCode(secretBase32: string, code: string, windowSteps = 1): boolean {
  return matchTotpStep(secretBase32, code, windowSteps) !== null;
}

