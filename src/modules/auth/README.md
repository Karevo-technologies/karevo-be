# Auth module

This module handles sign-in, sessions and the refresh cookie. It is the reference implementation: copy its patterns (DTOs, `AppException`, activity events, transactions) in the other modules.

| Endpoint | State |
| --- | --- |
| `POST /auth/register` | done |
| `POST /auth/login` | done, including the 2FA challenge branch |
| `POST /auth/2fa/verify` | stubbed |
| `POST /auth/refresh` | done |
| `POST /auth/logout` | done |
| `POST /auth/password/forgot` | stubbed |
| `POST /auth/password/reset` | stubbed |

All of these routes are `@Public()`, so `JwtAuthGuard` skips them.

## Files

- `auth.service.ts`: registration, login, refresh and logout logic.
- `session.service.ts`: creates, rotates, revokes and validates sessions. Settings uses it for the Devices endpoints.
- `jwt-auth.guard.ts`: global guard. It checks the bearer token, then the session behind it, then `@RequireVerifiedNin()`.
- `refresh-cookie.ts`: the `karevo_rt` cookie (HttpOnly, SameSite=Strict, `Path=/api/v1/auth`).
- `device.ts`: turns the user agent into a device name such as "Chrome on Windows".
- `password-policy.ts`: placeholder breached-password list (D-11).

## How it works

- **Register:** validates the body, rejects common passwords, checks email and NIN are unique (`409`), then creates the user, preferences, a NIN linked ID, the session and an activity event in one transaction. `ninStatus` stays `pending` until `NinVerificationJob` runs.
- **Login:** any wrong factor (unknown email, wrong password, wrong NIN, deactivated account) gives the same `401 INVALID_CREDENTIALS`. An unknown email still runs an Argon2 check, so response time doesn't reveal which emails exist. Failures on a real account are logged to its activity.
- **Refresh:** rotates the secret on every call. Replaying an old secret revokes the session (D-13). The cookie is cleared on any failure.
- **Logout:** revokes the session if the cookie is valid, and always clears the cookie.

## 2FA

Implement `AuthService.verifyTwoFactor`:

1. Verify `challengeToken` with `JwtService`. Its `typ` must be `"2fa"`. If it is expired or invalid, return `401 UNAUTHENTICATED`.
2. Load the user and decrypt `twoFactorSecretEnc`. Check `code` as TOTP: 30-second step, 1 step of drift allowed. Use a maintained library such as `otplib`.
3. A wrong code gives `401 INVALID_CREDENTIALS` and an activity event. The route is already throttled like login.
4. On success, do what `login` does: `sessions.create`, a "Signed in" event and `issueAccessToken`. Return `{ body, refreshToken }`; the controller sets the cookie.

Enabling and confirming 2FA is in the account module (D-01).

## Password reset

`forgotPassword`:

- Look up the user by email. Whether or not one exists, return without error; the controller sends `202`.
- If the user exists, create a `PasswordResetToken` with `tokenHash = crypto.sha256(token)`, where `token = crypto.randomToken()`, expiring in 30 minutes.
- Email a link containing the plain token. Email delivery is not built yet: add a `MailService` in `src/mail/` behind an interface.

`resetPassword`:

- Find the token by `sha256(dto.token)`. It must be unused and unexpired; otherwise return `400 VALIDATION_FAILED` with a `token` field error.
- Apply the register password rules, including `isBreachedPassword`.
- In one transaction: update `passwordHash`, set `usedAt`, revoke all of the user's sessions, and record an `auth` event "Password reset".

## Still to do here

- IP-to-city lookup for `session.location`, currently `null`.
- Replace the breached-password list (D-11).
- Redis-backed throttler storage before running more than one instance (D-09).
