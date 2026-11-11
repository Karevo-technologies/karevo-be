import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PasswordPolicyService } from './password-policy';

const PASSWORD = 'a-long-and-unusual-passphrase';
const SHA1 = createHash('sha1').update(PASSWORD).digest('hex').toUpperCase();

function policy(remoteCheck = true) {
  return new PasswordPolicyService(new ConfigService({ BREACHED_PASSWORD_CHECK: remoteCheck }) as never);
}

function rangeResponse(body: string, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as Response;
}

describe('PasswordPolicyService', () => {
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  it('rejects common passwords without a network call', async () => {
    expect(await policy().isBreached('Password123')).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends only the 5-character hash prefix', async () => {
    fetchMock.mockResolvedValue(rangeResponse(''));
    await policy().isBreached(PASSWORD);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.pwnedpasswords.com/range/${SHA1.slice(0, 5)}`,
      expect.anything(),
    );
  });

  it('rejects a password whose suffix appears in the range', async () => {
    fetchMock.mockResolvedValue(rangeResponse(`0000000000000000000000000000000000A:3\r\n${SHA1.slice(5)}:42\r\n`));
    expect(await policy().isBreached(PASSWORD)).toBe(true);
  });

  it('ignores padding rows with a count of 0', async () => {
    fetchMock.mockResolvedValue(rangeResponse(`${SHA1.slice(5)}:0\r\n`));
    expect(await policy().isBreached(PASSWORD)).toBe(false);
  });

  it('allows the password when the API errors or is unreachable', async () => {
    fetchMock.mockResolvedValueOnce(rangeResponse('', 503));
    expect(await policy().isBreached(PASSWORD)).toBe(false);

    fetchMock.mockRejectedValueOnce(new Error('network down'));
    expect(await policy().isBreached(PASSWORD)).toBe(false);
  });

  it('skips the API when the remote check is turned off', async () => {
    expect(await policy(false).isBreached(PASSWORD)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
