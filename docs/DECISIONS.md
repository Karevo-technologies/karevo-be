# Decisions

These are the places where the backend departs from, or adds to, its specs: the **Karevo Users Dashboard — Backend Technical Spec** (Oct 28, 2026) for D-01 to D-21, and the admin spec plus [ORG_AND_ADMIN_PLAN.md](ORG_AND_ADMIN_PLAN.md) for D-22 onwards. Each entry says what was decided and why. Review them, and change the spec or the code wherever you disagree.

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

`PasswordPolicyService` (`password-policy.ts`) checks every new password: patient sign-up, password reset and change, and organisation invite acceptance. It first checks a small local deny-list, then the Have I Been Pwned range API. Only the first 5 hex characters of the password's SHA-1 hash leave the server.

If the API is down or slow, the check **fails open** and the password is allowed, so an outage never blocks sign-up. `BREACHED_PASSWORD_CHECK=false` turns the remote check off; the tests do this.

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

## Organisation and admin APIs

These entries come from [ORG_AND_ADMIN_PLAN.md](ORG_AND_ADMIN_PLAN.md), which is where the product questions (Q1–Q7) were settled. The details are in the [org](../src/modules/org/README.md) and [admin](../src/modules/admin/README.md) module READMEs.

### D-22 · Three separate login realms · Proposed

Patients, organisation staff and Karevo admins each have their own account table, session table, token `typ` and refresh cookie:

| Realm | Table | Token `typ` | Cookie | Path |
| --- | --- | --- | --- | --- |
| Patient | `User` | `access` | `karevo_rt` | `/api/v1/auth` |
| Organisation | `OrgMember` | `org_access` | `karevo_org_rt` | `/api/v1/org/auth` |
| Admin | `AdminUser` | `admin_access` | `karevo_admin_rt` | `/api/v1/admin/auth` |

Admin tokens are signed with `JWT_ADMIN_SECRET`, which must differ from `JWT_ACCESS_SECRET` (admin spec §2.1). Each realm's guard refuses the other two realms' tokens, and the wiring test checks every pair.

One table with a `role` column would have been less code, but then a single bug in a role check could let a patient token reach organisation or admin routes. Separate realms make that mistake a type error and a failing test instead.

Session rotation, replay detection (D-13) and per-request checks (D-12) are shared through `src/common/sessions`. Session lifetimes: organisation 7 days with a 1-hour idle limit; admin 12 hours with a 15-minute idle limit.

### D-23 · Admin MFA is mandatory, set up at first sign-in · Proposed

Admins have no account settings page, so MFA can't be opt-in the way it is for patients (D-01). On an admin's first sign-in, the login response includes a `setupUri`. The first valid code both confirms the authenticator and completes the sign-in. After that, every sign-in needs a code.

Admins are created only with `npm run admin:create`, which prints a one-time password. There is no admin sign-up and no way to manage admins from the console yet.

Known gap: there is no MFA reset. If an admin loses their authenticator, clear `totpSecretEnc` and `totpConfirmedAt` in the database, and they set it up again at their next sign-in.

### D-24 · Manual NIN verification · Proposed

No NIN vendor is contracted, and the stub provider (D-21) can't run in production. `NIN_PROVIDER=manual` leaves every NIN `pending` and turns off the verification job. Admins then decide with `POST /admin/users/:id/nin {decision: verified | failed, reasonCode, note?}`.

The plan named this `POST /admin/users/:id/nin/verify`. It became one route with a `decision` field so that a failure is recorded the same way as a success.

Production should use `manual` until a vendor's provider is written. `render.yaml` sets it.

### D-25 · No 2FA for organisation staff in the beta · Proposed

Staff sign in with email and password only. Every staff account is created by invitation, organisation access is limited to verified organisations, and every record read is audited (D-28). Add TOTP for staff, along with a staff password reset, before general availability. Until then, an organisation admin can re-invite a member who has forgotten their password.

### D-26 · Invite responses include the invite link · Proposed

`POST /org/members`, `POST /org/members/:id/invite`, `POST /admin/orgs` and `POST /admin/orgs/:id/admins` return `inviteUrl` (`ORG_DASHBOARD_URL/auth/accept-invite?token=…`). No email is sent yet, so the person sending the invite passes the link on themselves.

The link is a credential: it sets the account's password. The token is stored only as a SHA-256 hash, works once, and stops working when a new invite is sent. When email delivery is live, stop returning `inviteUrl`.

### D-27 · Audit tables are append-only in the database · Proposed

The admin spec requires a tamper-evident audit trail. A Postgres trigger refuses `UPDATE` and `DELETE` on `AdminActionLog` and `RecordAccessEvent`, so the application can't change history even with a bug or a compromised service account.

The only bypass is the transaction-local setting `karevo.audit_maintenance = 'on'`, which the development seed uses to reset demo data. The application never sets it.

A user with database owner rights can still drop the trigger. Before launch, run the application as a database role that doesn't own these tables.

### D-28 · Organisations read records only through a consent or a visit, and every read is audited · Proposed

An organisation can read a patient's records only through:

- an active, unexpired consent whose scope covers the record's category (D-06), or
- a visit grant, which lasts 2 hours and covers every record.

Each read writes one `RecordAccessEvent` per record, plus an entry in both the patient's and the organisation's activity, all **in the same transaction as the read**. If those writes fail, the read fails, so no read goes unrecorded. Record lists without contents (`GET /org/records`) are not audited.

**Visit QR (plan Q2).** The patient creates a code with `POST /me/visit-qr` (needs a verified NIN), and the organisation redeems it with `POST /org/visits`. Codes are single-use, last 5 minutes and are stored only as a SHA-256 hash. If a code is redeemed twice at once, only one redemption is accepted.

### D-29 · Organisation status controls access · Proposed

`Organisation.status` (`pending | verified | rejected | suspended`) replaces the boolean `verified`, and the migration keeps existing verified rows verified.

- Admins move organisations between statuses, and every change needs a reason code. The allowed transitions are in the admin README.
- Until an organisation is `verified`, its staff can sign in, edit the profile and invite the team, but patient routes return `403 ORG_NOT_VERIFIED`.
- Rejecting or suspending an organisation revokes every staff session, and the per-request session check refuses it from then on.

### D-30 · Admin action logging · Proposed

Every admin state change carries a `reasonCode` from a fixed list (`REASON_CODES`), so the log can be queried, and `other` requires a note. The log entry is written in the same transaction as the change.

Some reads are logged as well: looking up a patient (`user.view`) and failed sign-ins. That way, unusual browsing of patient accounts appears in the audit trail. Admins see patient metadata only, never record contents.

### D-31 · Health check and deployment · Proposed

`GET /api/v1/health` is public and not rate-limited. It returns `200` when the database answers and `503` when it doesn't, so Render restarts or holds traffic.

`npm start` runs `node dist/main`. Running `nest start` in production recompiles TypeScript and ran out of memory on Render. `render.yaml` builds once, runs `prisma migrate deploy` at start, and uses a paid instance, because the free plan sleeps and that stops the scheduled jobs.
