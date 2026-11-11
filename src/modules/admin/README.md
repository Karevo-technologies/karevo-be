# Admin module (`/api/v1/admin`)

This is the API for the Karevo internal console (`karevo-admin`). Karevo staff use it to onboard and verify organisations, verify NINs manually, and review the audit trail. Every route is implemented.

## How admin accounts work

- **There is no sign-up.** The first super admin is created from the command line, and it prints a one-time password:

  ```sh
  npm run admin:create -- --email ada@karevo.ng --name "Ada Obi" --role super_admin
  ```

- **MFA (TOTP) is mandatory at every sign-in** (D-23). Login takes two steps:
  1. `POST /admin/auth/login` checks the password and returns `{ mfaRequired: true, mfaSetupRequired, challengeToken }`. On an admin's first sign-in it also returns `setupUri` to show as a QR code. The setup secret stays the same until it is confirmed, so reloading the page shows the same QR.
  2. `POST /admin/auth/2fa/verify {challengeToken, code}` checks the code and signs the admin in. On the first sign-in, this valid code also confirms the authenticator. Each code works only once, even if it's sent twice at once.
- **Admin tokens are separate from other tokens.** They are signed with `JWT_ADMIN_SECRET`, not `JWT_ACCESS_SECRET`, and carry `typ: admin_access` (D-22). `AdminAuthGuard` refuses patient and organisation tokens, and the other two realms refuse admin tokens.
- **Sessions:** the refresh cookie is `karevo_admin_rt`, scoped to `/api/v1/admin/auth`. Sessions last 12 hours, with a 15-minute idle limit. The session and the admin's role are checked on every request, so revoking access or changing a role takes effect at once.
- **Roles** are `super_admin`, `compliance_officer`, `ops_support` and `analyst`, matching `karevo-admin/lib/rbac.ts`. Every route must declare `@AdminRoles(...)`. A route without it is refused for everyone, so a forgotten decorator fails closed.
- Failed sign-ins (wrong password, or a wrong or reused code) are written to the admin action log.

## Endpoints

| Method | Path | Roles | Purpose |
| --- | --- | --- | --- |
| POST | `/admin/auth/login` `{email, password}` | — | Step 1: password; returns a challenge (and `setupUri` on first sign-in) |
| POST | `/admin/auth/2fa/verify` `{challengeToken, code}` | — | Step 2: TOTP code; signs in |
| POST | `/admin/auth/refresh`, `/admin/auth/logout` | — | Refresh cookie |
| GET | `/admin/me` | all | Signed-in admin |
| GET | `/admin/overview` | all | KPI cards; aggregates only, cached for 1 minute |
| POST | `/admin/orgs` | super_admin, ops_support | Create an organisation (`pending`) and invite its first admin; returns `inviteUrl` (D-26) |
| GET | `/admin/orgs?status=&q=&cursor=` | super_admin, ops_support | Organisation list; `q` matches the name |
| GET | `/admin/orgs/:id` | super_admin, ops_support | Detail: members and activity counts |
| POST | `/admin/orgs/:id/approve` \| `reject` \| `suspend` \| `reinstate` `{reasonCode, note?}` | super_admin, ops_support | Verification queue (see below) |
| POST | `/admin/orgs/:id/admins` `{name, email, reasonCode, note?}` | super_admin, ops_support | Invite another admin for the organisation, e.g. when its only admin has left |
| GET | `/admin/users/:karevoId` | super_admin, ops_support | Patient account metadata. **Logged** |
| POST | `/admin/users/:id/nin` `{decision: verified\|failed, reasonCode, note?}` | super_admin, ops_support | Manual NIN verification (D-24) |
| GET | `/admin/consents?status=&orgId=&karevoId=&cursor=` | super_admin, compliance_officer | Consent monitor |
| GET | `/admin/audit/record-access?karevoId=&orgId=&via=&from=&to=&cursor=` | super_admin, compliance_officer | Every read of a patient record |
| GET | `/admin/audit/admin-actions?adminId=&action=&targetType=&targetId=&cursor=` | super_admin, compliance_officer | Admin action log |

`analyst` sees only `/admin/me` and `/admin/overview` for now.

## Organisation status

| Action | From | To |
| --- | --- | --- |
| approve | `pending`, `rejected` | `verified` |
| reject | `pending` | `rejected` |
| suspend | `verified` | `suspended` |
| reinstate | `suspended` | `verified` |

Any other transition returns `409`. **Reject and suspend also end every staff session at once**, so the organisation loses access on its next request. Until an organisation is `verified`, its staff can sign in and set up their team, but every patient route returns `403 ORG_NOT_VERIFIED` (see the [org module README](../org/README.md)).

## Rules the code enforces

- **Every state change needs a reason code** (admin spec §6). The codes are listed in `REASON_CODES` in `admin-context.ts`. `other` must come with a note of at least 3 characters.
- **Every state change is logged in the same transaction** through `AdminAuditService.log(..., tx)`. If the log entry can't be written, the change is rolled back.
- **The audit tables are append-only, enforced by the database** (D-27). A trigger refuses `UPDATE` and `DELETE` on `AdminActionLog` and `RecordAccessEvent`. The only bypass is a transaction-local setting the development seed uses to reset demo data. The application never sets it.
- **Admins see patient metadata, never record contents** (admin spec §4.3). Patients are looked up by Karevo ID only, with no name search. Email and NIN are masked, and each lookup is itself logged as `user.view`.
- **The oversight views identify patients by Karevo ID, not by name.**
- **Manual NIN decisions** update `user.ninStatus` and the NIN linked ID together, add an entry to the patient's activity, and record the before and after status in the action log.

## Changes needed in `karevo-admin`

- **Sign-in:** two steps. Show `setupUri` as a QR code when `mfaSetupRequired` is true.
- **Every action button** (approve, suspend, NIN decisions and so on) needs a reason picker that uses the codes above, and a note field that is required for `other`.
- **Requests:** send every request with `credentials: 'include'`, and add the console's origin to `CORS_ORIGINS`.
- **Data:** replace the mock data on the Records and Compliance pages with the audit and consent endpoints.

## Not built yet

These are in the admin spec, but the console has no finished screens for them yet (plan §5, "After the beta"):

- data-subject requests (export and erasure), security alerts, anomaly flags
- freezing accounts with four-eyes approval
- managing admins from the console (use `npm run admin:create` for now), and resetting an admin's MFA
- support tickets, feature flags, consent and terms versioning, broadcasts
