import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'crypto';
import { Env } from '../config/env';

// No 0/O/1/I/L, so codes read back unambiguously over the phone.
const SHARE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * All cryptography in one place: field encryption at rest, lookup hashes,
 * password/PIN hashing and random codes. See docs/DECISIONS.md (D-08).
 */
@Injectable()
export class CryptoService {
  private readonly dataKey: Buffer;
  private readonly indexKey: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const dataKey: string = config.get('DATA_ENCRYPTION_KEY', { infer: true });
    const indexKey: string = config.get('BLIND_INDEX_KEY', { infer: true });
    this.dataKey = Buffer.from(dataKey, 'base64');
    this.indexKey = Buffer.from(indexKey, 'base64');
  }

  /** AES-256-GCM. Output: base64(iv | tag | ciphertext). */
  encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.dataKey, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }

  decrypt(encoded: string): string {
    const buf = Buffer.from(encoded, 'base64');
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.dataKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString('utf8');
  }

  /** Deterministic keyed hash, for equality lookups on encrypted values. */
  blindIndex(value: string): string {
    return createHmac('sha256', this.indexKey).update(value).digest('hex');
  }

  /** For high-entropy secrets (refresh and reset tokens), where Argon2 adds nothing. */
  sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }

  hashSecret(secret: string): Promise<string> {
    return argon2.hash(secret, { type: argon2.argon2id });
  }

  verifySecret(hash: string, secret: string): Promise<boolean> {
    return argon2.verify(hash, secret).catch(() => false);
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  /** XXXX-XXXX from a CSPRNG (~40 bits). */
  shareCode(): string {
    const pick = () =>
      Array.from({ length: 4 }, () => SHARE_CODE_ALPHABET[randomInt(SHARE_CODE_ALPHABET.length)]).join('');
    return `${pick()}-${pick()}`;
  }

  /** KV-dddd-dddd. Callers retry on the unique-constraint collision. */
  karevoId(): string {
    const block = () => randomInt(0, 10_000).toString().padStart(4, '0');
    return `KV-${block()}-${block()}`;
  }

  static maskNin(last4: string): string {
    return `*******${last4}`;
  }
}
