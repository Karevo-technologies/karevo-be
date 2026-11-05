# Decisions

These are the places where the backend departs from, or adds to, the **Karevo Users Dashboard — Backend Technical Spec** (Oct 28, 2026). Each entry says what was decided and why. Review them, and change the spec or the code wherever you disagree.

Status: **Proposed** until reviewed. Change it to **Accepted** or **Rejected** in the entry itself.

## Endpoints added or changed

The spec defines 32 endpoints. The scaffold has 38: six are added (D-01, D-02, D-03 and D-05), and one changes its method (D-04).

| # | Change | Endpoint(s) |
| --- | --- | --- |
| D-01 | 2FA login step and confirmation | `POST /auth/2fa/verify`, `POST /me/2fa/confirm` |
| D-02 | Setting the first PIN, and checking a PIN | `PUT /me/pin` (first-PIN mode), `POST /me/pin/verify` |
| D-03 | Password reset | `POST /auth/password/forgot`, `POST /auth/password/reset` |
| D-04 | Export is `POST`, not `GET` | `POST /me/export` |
| D-05 | The ID-card endpoint the spec mentions | `GET /me/id-card` |

### D-01 · 2FA login step · Proposed

The spec has `PUT /me/2fa` return a `setupUri`, but it has no way to confirm the setup and no 2FA step at login.

- `PUT /me/2fa {enabled: true}` stores an encrypted TOTP secret and returns `{ enabled: false, setupUri }`. 2FA is not active yet.
- `POST /me/2fa/confirm {code}` checks the code against the secret, sets `twoFactorEnabled`, and returns `{ enabled: true }`.
- `PUT /me/2fa {enabled: true}` returns `409` while 2FA is already on, so the active secret is never replaced.
- `PUT /me/2fa {enabled: false}` requires either `password` or a current `code` while 2FA is on. Cancelling an unconfirmed setup needs neither.
- Each TOTP code works once: the accepted time step is stored in `twoFactorLastStep`, and codes at or below it are refused.
- When 2FA is on, `POST /auth/login` returns `200 { twoFactorRequired: true, challengeToken }`, with no tokens and no cookie. `challengeToken` is a JWT with `typ: "2fa"` that lasts 5 minutes. `POST /auth/2fa/verify {challengeToken, code}` then completes the login exactly as a normal login does.

TOTP only. This answers the spec's open question "TOTP app, SMS, or both?" provisionally: SMS adds cost and SIM-swap risk.

### D-02 · PIN setup and verification · Proposed

`PUT /me/pin` requires a `currentPin`, so there was no way to set the first PIN. There was also no endpoint to check a PIN, even though the spec rate-limits PIN attempts.

- `PUT /me/pin` with `{ password, newPin }` when the account has no PIN yet; with `{ currentPin, newPin }` after that.
- `POST /me/pin/verify {pin}` returns `204` on success. After 5 wrong attempts it locks PIN checks for 15 minutes with `423 ACCOUNT_LOCKED` (`pinFailedCount`, `pinLockedUntil`). The lock covers PIN checks only, not password login.
- Trivial PINs (`0000`, `1234`, …) are rejected using `isTrivialPin()`.

### D-03 · Password reset · Proposed

The spec has no forgot-password flow.

- `POST /auth/password/forgot {email}` always returns `202`, so it never reveals whether an account exists. It stores the SHA-256 of a random token with a 30-minute expiry and emails a link.
- `POST /auth/password/reset {token, newPassword}` applies the same password rules as registration, marks the token used, **revokes every session**, and logs an `auth` event.

### D-04 · `POST /me/export` · Proposed

The spec lists `GET /me/export` returning `202`. Starting a job is a side effect, so `GET` is the wrong method: browsers and proxies may prefetch or retry it. The endpoint creates a `DataExportJob` row.

### D-05 · `GET /me/id-card` · Proposed

The spec says NINs are masked "everywhere except the owner's ID card endpoint", but it never defines that endpoint. `GET /me/id-card` returns `{ karevoId, name, nin, ninStatus }` with the NIN unmasked. Every other response masks it, `GET /me` included.

## Data and authorisation

### D-06 · Record category maps to consent scope · Proposed

The spec says organisations see a record only through a consent "whose scope covers it", but records had only a free-text `type`.

Each `HealthRecord` therefore gets a `category` drawn from the same enum as consent scopes and share categories. It can be any value except `full`. A scope covers a record when it includes the record's `category` or `full`. The `id` scope covers identity data (`name`, `karevoId`, masked NIN) and no records.

Organisations must set `category` when they upload a record.

### D-07 · Share tokens · Proposed

- The plain `code` appears only in the `POST /share-tokens` response. The database stores an HMAC of it (`codeHash`), and `GET /share-tokens` never returns it.
- A token is **dead** when `revokedAt` or `usedAt` is set, or `expiresAt` is in the past. This is computed on read, so expiry needs no sweep job.
- `single` tokens have `expiresAt = null` and die on first use.
- The expiry enum is stored as `1h | 24h | 7d | single`. The Prisma client calls these `h1 | h24 | d7 | single`, and `EXPIRY_TO_DB` and `EXPIRY_FROM_DB` convert between the two.
- The endpoint organisations use to redeem a token belongs to the organisation API and is not defined here. It must compare HMACs, check that the token is not dead, set `usedAt` for `single` tokens, and log an event on the user's timeline.

### D-08 · Encryption in the application, not `pgcrypto` · Proposed

NIN, linked-ID numbers, record `details` and the TOTP secret are encrypted in Node with AES-256-GCM (`CryptoService`), using `DATA_ENCRYPTION_KEY`.

With `pgcrypto`, the key would travel inside SQL statements, where it can end up in query logs and `pg_stat_statements`. Encrypting in the application keeps the key out of the database entirely.

Lookups on encrypted values use an HMAC blind index keyed by `BLIND_INDEX_KEY` (`ninHash`, `codeHash`).

Not built yet: key rotation. When it's needed, prefix each ciphertext with a key version.

### D-18 · The NIN is also a linked ID · Proposed

Registration creates a `LinkedId` of type `nin`, and the NIN verification job keeps its `status` in step with `user.ninStatus`. This way the Linked IDs screen shows the NIN with no special case.

### D-19 · `ScanRequest` table · Proposed

The QR flow needs somewhere to store an organisation's request between `POST /scan/resolve` and `POST /scan/:requestId/confirm`, so a `ScanRequest` table was added. The QR payload format is still an open question (see the sharing README).

## Sessions and security

### D-09 · Throttling instead of account lockout · Proposed

The spec returns `423` after 5 failed logins "per account". Anyone who knows a user's email could then lock that user out on purpose.

Instead, login is throttled at 5 attempts per 15 minutes per **IP + email** pair (`KarevoThrottlerGuard`). Every failure still appears in the user's activity log. Account lockout (`423`) is used for PINs only (D-02).

Known gap: an attacker spread across many IPs is not slowed by this. Add a CAPTCHA after repeated failures, or a slower per-account backoff, before launch.

Throttler storage is in memory. Move it to Redis before running more than one instance.

### D-10 · Extra error codes · Proposed

Codes added to the spec's table:

- `UNAUTHENTICATED` (401): missing, invalid or revoked token. The client should send the user to `/login` and should not try to refresh.
- `NOT_IMPLEMENTED` (501): scaffolded endpoints.
- `FORBIDDEN` (403): for example, a refresh request from an untrusted origin.
- `INTERNAL_ERROR` (500): never carries any detail.

`TOKEN_EXPIRED` is still the only code that means "refresh once, then retry".

### D-11 · Breached-password check · Proposed

A small local deny-list stands in for now (`password-policy.ts`). Before launch, replace it with a k-anonymity check against Have I Been Pwned, or an offline copy of that list.

### D-12 · The session is checked on every request · Proposed

`JwtAuthGuard` looks up the session behind the access token's `sid` on each request. This costs one indexed read per request, and in return removing a device or signing out other sessions takes effect immediately, not up to 15 minutes later.

The same check enforces **auto sign-out** on the server. A session idle for longer than `autoSignOutMinutes` is revoked, and `0` turns the limit off.

`lastActiveAt` is written at most once a minute per session.

### D-13 · Detecting a reused refresh token · Proposed

The refresh token is `<sessionId>.<secret>`, and the secret changes on every refresh. If a request presents the right session id with an old secret, the token was replayed, so the whole session is revoked and the event is logged.

**Client requirement:** run one refresh at a time. Two tabs refreshing at once would trip this check, so the `apiFetch` wrapper must share a single in-flight refresh promise.

### D-14 · Refresh cookie across origins · Proposed

The refresh cookie is `HttpOnly; SameSite=Strict; Path=/api/v1/auth`. A `SameSite=Strict` cookie is sent only when the API and the dashboard share a registrable domain, for example `api.karevo.ng` and `app.karevo.ng`. Deploy them that way.

The client must call the API with `credentials: 'include'`, and CORS allows credentials only for the origins in `CORS_ORIGINS`.

For CSRF, on top of `SameSite=Strict`, `/auth/refresh` and `/auth/logout` reject requests whose `Origin` header is not on that list.

### D-15 · Which actions need a verified NIN · Proposed

`@RequireVerifiedNin()` (`403 NIN_NOT_VERIFIED`) applies to:

- approving, declining or revoking a consent
- creating a share token
- `POST /scan/resolve` and `POST /scan/:requestId/confirm`

Reads stay open, so a user whose NIN is still pending can see the dashboard.

### D-20 · How the 2FA challenge is returned · Proposed

The challenge is a `200` with `twoFactorRequired: true`, not an error status. It is a normal step of the login flow, and the client can branch on the response body.

### D-21 · Stub NIN provider · Proposed

`NIN_PROVIDER=stub` marks every pending NIN verified within about a minute, so engineers can exercise the NIN-gated flows locally. Startup fails if the stub is configured in production.

## Response shapes

### D-16 · The records list leaves out `details` · Proposed

`GET /records` returns no `details`; only `GET /records/:id` decrypts and returns them. Lists stay cheap, and the full text is decrypted only when the user opens a record.

### D-17 · The consent `history` tab · Proposed

`?status=history` means status `declined`, `revoked` or `expired`. `pending` and `active` map one-to-one to their status.
