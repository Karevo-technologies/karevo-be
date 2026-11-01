import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { CryptoService } from './crypto.service';

function makeService() {
  const config = new ConfigService({
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    BLIND_INDEX_KEY: randomBytes(32).toString('base64'),
  });
  return new CryptoService(config as never);
}

describe('CryptoService', () => {
  const crypto = makeService();

  it('round-trips encrypted values and uses a fresh IV each time', () => {
    const a = crypto.encrypt('12345678901');
    const b = crypto.encrypt('12345678901');
    expect(a).not.toEqual(b);
    expect(crypto.decrypt(a)).toBe('12345678901');
  });

  it('rejects tampered ciphertext', () => {
    const buf = Buffer.from(crypto.encrypt('secret'), 'base64');
    buf[buf.length - 1] ^= 1;
    expect(() => crypto.decrypt(buf.toString('base64'))).toThrow();
  });

  it('produces a deterministic blind index per key', () => {
    expect(crypto.blindIndex('12345678901')).toBe(crypto.blindIndex('12345678901'));
    expect(makeService().blindIndex('12345678901')).not.toBe(crypto.blindIndex('12345678901'));
  });

  it('issues share codes and Karevo IDs in the documented formats', () => {
    for (let i = 0; i < 50; i++) {
      expect(crypto.shareCode()).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
      expect(crypto.karevoId()).toMatch(/^KV-\d{4}-\d{4}$/);
    }
  });

  it('hashes secrets with Argon2id', async () => {
    const hash = await crypto.hashSecret('hunter22');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await crypto.verifySecret(hash, 'hunter22')).toBe(true);
    expect(await crypto.verifySecret(hash, 'hunter23')).toBe(false);
  });

  it('masks the NIN to its last four digits', () => {
    expect(CryptoService.maskNin('8901')).toBe('*******8901');
  });
});
