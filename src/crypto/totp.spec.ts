import { currentTotpStep, generateTotpCode, generateTotpSecret, matchTotpStep, verifyTotpCode } from './totp';

describe('TOTP utils', () => {
  it('generates a valid base32 secret and verifies matching codes', () => {
    const secret = generateTotpSecret();
    expect(secret.length).toBeGreaterThanOrEqual(16);

    const code = generateTotpCode(secret);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotpCode(secret, code)).toBe(true);
    expect(verifyTotpCode(secret, '999999')).toBe(false);
  });

  it('allows 1-step window drift', () => {
    const secret = generateTotpSecret();
    const prevCode = generateTotpCode(secret, -1);
    const nextCode = generateTotpCode(secret, 1);
    expect(verifyTotpCode(secret, prevCode)).toBe(true);
    expect(verifyTotpCode(secret, nextCode)).toBe(true);

    const farCode = generateTotpCode(secret, 2);
    expect(verifyTotpCode(secret, farCode, 1)).toBe(false);
  });

  it('reports the time step a code matched', () => {
    const secret = generateTotpSecret();
    expect(matchTotpStep(secret, generateTotpCode(secret, -1))).toBe(currentTotpStep() - 1);
    expect(matchTotpStep(secret, 'abc')).toBeNull();
  });
});

