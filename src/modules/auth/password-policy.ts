// A short local deny-list so the rule exists from day one.
// TODO(auth owner): replace with a k-anonymity breached-password check
// (e.g. the Have I Been Pwned range API) before launch; see docs/DECISIONS.md (D-11).
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty123', 'qwertyuiop', '11111111', '00000000', 'iloveyou', 'abcd1234',
  'admin123', 'welcome1', 'letmein1', 'football', 'baseball', 'sunshine',
  'princess', 'trustno1', 'passw0rd', 'karevo123',
]);

export function isBreachedPassword(password: string): boolean {
  return COMMON_PASSWORDS.has(password.toLowerCase());
}
