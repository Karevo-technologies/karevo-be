# Organisation module (`/api/v1/org`)

This is the API for the organisation dashboard (`karevo-doctors-dashboard`): hospitals, clinics, labs, schools and insurers. Every route is implemented.

## How organisation accounts work

- **Staff accounts are invite-only.** A Karevo admin creates the organisation and invites its first admin. That admin then invites the rest of the team.
- **Every route except `/org/auth/*` needs an organisation access token** (`typ: org_access`). Patient and admin tokens are refused (`OrgAuthGuard`).
- **Roles:** `admin` manages the profile and team. `member` does the patient work. Routes marked `@OrgRoles('admin')` return `403` to members.
- **Organisation status** is set by Karevo admins:
  - Until the organisation is `verified`, every patient route returns `403 ORG_NOT_VERIFIED`. Staff can still sign in, edit the profile and invite their team.
  - A `suspended` or `rejected` organisation loses access immediately. The session check on every request refuses it, and its sessions are revoked as well.
- **Sessions:** the refresh cookie is `karevo_org_rt`, scoped to `/api/v1/org/auth`. Sessions last 7 days, with a 1-hour idle limit. Rotation and replay detection work the same way as for patients.

## Endpoints

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| POST | `/org/auth/invite/accept` `{token, name, password}` | invitee | Set a password and activate; signs in |
| POST | `/org/auth/login` `{email, password}` | staff | Sign in |
| POST | `/org/auth/refresh`, `/org/auth/logout` | staff | Refresh cookie |
| GET | `/org/me` | any | Signed-in member and their organisation |
| GET | `/org/summary` | any | Home stat cards |
| GET | `/org/activity?cursor=` | any | Activity page |
| GET / PATCH | `/org/profile` | GET any, PATCH admin | Organisation details |
| GET | `/org/members` | any | Team list |
| POST | `/org/members` `{name, email, role}` | admin | Invite; returns `inviteUrl` (D-26) |
| POST | `/org/members/:id/invite` | admin | New invite link; the old one stops working |
| DELETE | `/org/members/:id` | admin | Remove; ends their sessions. The last admin can't be removed |
| GET | `/org/patients/:karevoId` | verified org | Name, active consent scopes, visit expiry |
| GET | `/org/patients/:karevoId/records` | verified org | All records during a visit, otherwise records covered by active consents. **Audited** |
| POST | `/org/patients/:karevoId/records` | verified org | Upload a text record (plan Q5) |
| GET | `/org/records?cursor=` | verified org | Records this organisation issued (metadata only) |
| POST | `/org/consent-requests` `{karevoId, scope[], purpose, requestedDays}` | verified org | Ask a patient for access |
| GET | `/org/consent-requests?status=pending\|active\|history` | verified org | Requests list |
| GET | `/org/consent-requests/:id` | verified org | One request |
| GET | `/org/consent-requests/:id/records` | verified org | Records one active consent covers. **Audited** |
| POST | `/org/visits` `{code}` | verified org | Redeem a patient's visit QR for a 2-hour grant |

## Rules the code enforces

- **Record access.** An organisation reads records only through:
  - an `active`, unexpired consent whose scope covers them (`full` covers everything; `id` covers no records), or
  - a live visit grant.
- **Every read is audited in the same transaction.** It writes one `RecordAccessEvent` per record, plus an entry in the patient's activity ("<Org> viewed N of your records") and in the organisation's. If those writes fail, the read fails.
- **Visit QR codes** come from `POST /me/visit-qr` in the patient API. Each is single-use, expires after 5 minutes and is stored only as a SHA-256 hash. If a code is scanned twice at once, only one scan is accepted.
- **Duplicate requests are refused.** The same organisation can't have two pending requests for the same patient with the same scope (`409`).
- **Organisation activity** is written by this module and by the patient consents module: the patient's approve, decline and revoke decisions.

## Changes needed in `karevo-doctors-dashboard`

- **Patient IDs** use `KV-XXXX-XXXX`. Change the mocks and the `KID-…` placeholders (plan Q1).
- **The QR scanner** should send the scanned string to `POST /org/visits` instead of comparing it with the Karevo ID (plan Q2).
- **Hide "Add patient"** for the beta (plan Q3).
- **Uploads are text only:** replace the file input with summary and details fields, and add a category picker (plan Q5).
- **The request form** picks one or more categories and a duration of 7, 30 or 90 days (plan Q4).
- **The Users and Team pages** both read `/org/members`. Only admins can invite or remove, so members shouldn't see those buttons (plan Q7).
- **Add an invite-acceptance page** at `/auth/accept-invite?token=…` (the link format comes from `ORG_DASHBOARD_URL`).

## Not built yet

- 2FA for organisation staff (D-25)
- password reset for staff (an admin can re-invite instead)
- file uploads
- doctor credentials
