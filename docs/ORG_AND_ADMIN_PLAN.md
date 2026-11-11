# Plan: organisation and admin APIs in karevo-be

Status: **Draft for review** · Nov 7, 2026

`karevo-be` serves only the patient dashboard today. This plan adds the two other surfaces to the same API and the same database:

| Surface | Frontend repo | Who uses it | API prefix |
| --- | --- | --- | --- |
| Users dashboard | `karevo-users-dashboard` | patients | `/api/v1` (exists) |
| Organisation dashboard | `karevo-doctors-dashboard` | hospital, lab, school, insurer staff | `/api/v1/org` |
| Super admin dashboard | `karevo-admin` | Karevo staff | `/api/v1/admin` |

It's based on reading both frontends' screens, contexts and mock data, and `karevo-admin/docs/SUPER_ADMIN_DASHBOARD.md`. Neither frontend calls an API yet; both run entirely on mock data.

## 1. Why one backend

- **The consent rule lives in one place.** "An organisation sees a record only through an active consent that covers it" is the product's core privacy rule. Splitting backends means writing it twice.
- **Both new surfaces already depend on existing tables.** Organisations write `HealthRecord` and `ConsentRequest`, patients act on them, and admins audit both.
- **The admin spec asks for this directly:** "Same API layer … extended with admin-scoped endpoints — do not stand up a separate backend."

## 2. Decisions needed before building

These come from conflicts between the three frontends and the existing backend. Q1, Q2, Q3 and Q5 were decided on Nov 7, 2026. Q4, Q6 and Q7 go ahead as proposed unless someone objects in review.

### Q1 · What a patient ID looks like · **Decided: `KV-XXXX-XXXX`**

- The organisation app uses `KID-20260001`.
- The users app and the backend use `KV-2847-9931` (`User.karevoId`).

Organisation staff type this ID to find a patient, so it has to be one format everywhere.

**Proposal:** keep `KV-XXXX-XXXX`. It's random, so IDs can't be guessed in sequence the way `KID-2026000n` can, and it's already live. The organisation app's mocks and placeholder text change to match.

### Q2 · Which way the QR code works · **Decided: the organisation scans the patient**

- **Users spec (built in the backend as `/scan`):** the organisation shows a QR code and the patient scans it.
- **Organisation app (`ScanPatientQrModal`):** the patient shows a QR code and the organisation scans it, unlocking the patient's records "for this visit". The QR currently contains just the patient's ID.

A patient ID is not a secret, so a QR code containing only the ID gives no real consent: anyone who knows the ID could unlock the records.

**Proposal:**
- The patient app shows a **short-lived signed QR**: `POST /api/v1/me/visit-qr` returns a single-use code that expires in 5 minutes.
- The organisation scans it, and `POST /org/visits` redeems it, creating a **visit grant** (for example, 2 hours of read access to that patient's records).
- Keep the existing `/scan` endpoints for later, or drop them. Beta ships with one direction only.

### Q3 · "Add patient" for people without a Karevo account · **Decided: not in the beta**

The organisation app can register a patient (first and last name only) and upload records to that profile before the person has an account (`profileExists: false`).

That creates health data about someone who hasn't consented to Karevo, with no NIN to link it to them later. It raises NDPA questions and opens the door to duplicate or fake profiles.

**Proposal:** leave it out of the beta (hide the button). Later, an organisation could send an invite to the patient's phone or email, and records are attached only after the patient signs up and accepts.

### Q4 · What a consent request contains

| | Organisation app | Backend |
| --- | --- | --- |
| What's requested | one `recordType` (e.g. "Blood Test Result") | `scope[]` (`blood`, `vaccines`, `scripts`, `allergies`, `id`, `full`) |
| Reason | `reason` | `purpose` |
| How long | — | `requestedDays` (7, 30 or 90) |

**Proposal:** the organisation form lets staff tick one or more categories, give a reason and choose a duration (default 30 days). The backend model stays as it is. Record types map onto categories:

| Record type | Category |
| --- | --- |
| Vaccination History | `vaccines` |
| Blood Test Result | `blood` |
| Prescription Record | `scripts` |
| Medical Certificate | **new category `certificates`** |
| General Health Record | `full` |

Adding a category changes the enum shared with the users app.

### Q5 · File uploads · **Decided: text only for the beta**

The organisation app uploads records **as files** (`fileName`, e.g. a PDF). The backend stores text only (`summary`, `details`), and the users app says records "cannot be downloaded".

Real files need object storage (S3 or Cloudflare R2), encryption, file type and size limits, and short-lived view links instead of downloads.

**Proposal:** for the beta, records are **text only** (title, type, summary, details, notes). File uploads come as the first post-beta feature.

### Q6 · Organisation types

The organisation app shows "School", while the backend `OrgKind` allows only `hospital | insurer | pharmacy | lab`.

**Proposal:** expand it to `hospital | clinic | lab | pharmacy | insurer | school | employer | other`.

### Q7 · Organisation staff and "doctors"

- The organisation app has two overlapping lists: **Users** (`/organization/users`, email and invited/active) and **Team** (`/admin/team`, name, email and admin/member role).
- The admin spec talks about **Doctors** with credentials.

**Proposal:** one `OrgMember` list with role `admin | member`. Both pages read it; Team shows roles, Users shows invite status. Doctor credentials come after the beta.

## 3. Login and access rules (applies to everything below)

**Three separate account types.** Each has its own table, its own session table and its own token type:

| Account | Who | Token `typ` | Refresh cookie path |
| --- | --- | --- | --- |
| Patient | `User` | `access` | `/api/v1/auth` |
| Organisation staff | `OrgMember` | `org_access` | `/api/v1/org/auth` |
| Karevo staff | `AdminUser` | `admin_access` | `/api/v1/admin/auth` |

The admin realm also signs tokens with a **separate secret** (`JWT_ADMIN_SECRET`), as the admin spec requires. Each realm has its own global guard, so a patient token sent to `/org/...` is rejected and vice versa. Wiring tests prove this for every pair.

**Organisation access**
- Organisation staff accounts are **invite-only**. The login page already says so.
- An invite link lets the person set their password and activate.
- Members only ever see their own organisation's data.
- A suspended organisation, or a removed member, loses access immediately (the session is checked on every request, as for patients).

**Admin access**
- MFA (TOTP) is **mandatory** at every login.
- Idle timeout is 15 minutes.
- Roles are `super_admin | compliance_officer | ops_support | analyst`, enforced by a `@AdminRoles(...)` guard on each route, mirroring `karevo-admin/lib/rbac.ts`.
- Every action that changes state requires a `reasonCode`.

**Audit**
- **`RecordAccessEvent`:** written in the **same transaction** as every read of a record by an organisation or an admin. If the write fails, the read fails. The patient also sees "<Org> viewed your <record>" in their activity log.
- **`AdminActionLog`:** append-only. A database trigger blocks `UPDATE` and `DELETE`.

## 4. Data model changes

| Table | Change |
| --- | --- |
| `Organisation` | add `cacNumber`, `email`, `phone`, `authorisedPerson`, `status` (`pending \| verified \| rejected \| suspended`), `statusReason`; expand `kind` (Q6) |
| `OrgMember` | **new:** `orgId`, `name`, `email`, `role`, `passwordHash?`, `status` (`invited \| active \| removed`), `invitedById`, timestamps |
| `OrgInvite` | **new:** `memberId`, `tokenHash`, `expiresAt`, `usedAt` |
| `OrgSession` | **new:** same shape as `Session`, for organisation members |
| `HealthRecord` | add `title`, `notes`, `uploadedByMemberId` |
| `ConsentRequest` | add `requestedByMemberId` |
| `VisitGrant` | **new:** `userId`, `orgId`, `memberId`, `expiresAt`, created when a patient's visit QR is redeemed (Q2) |
| `VisitQrToken` | **new:** `userId`, `codeHash`, `expiresAt`, `usedAt` |
| `RecordAccessEvent` | **new:** `userId`, `recordId`, `orgId?`, `memberId?`, `adminId?`, `via` (`consent \| visit \| admin`), `consentId?`, `visitGrantId?`, `reasonCode?`, `at` |
| `AdminUser` | **new:** `email`, `name`, `role`, `passwordHash`, `totpSecretEnc`, `status` |
| `AdminSession` | **new** |
| `AdminActionLog` | **new, append-only:** `adminId`, `action`, `targetType`, `targetId`, `reasonCode`, `note`, `at` |
| `ShareCategory` enum | add `certificates` (Q4) |

## 5. Endpoints

### Organisation API: needed for the beta

| Endpoint | Screen |
| --- | --- |
| `POST /org/auth/invite/accept` `{token, name, password}` | invite link |
| `POST /org/auth/login`, `refresh`, `logout` | login |
| `GET /org/me` | navbar, `ProtectedRoute` |
| `GET /org/summary` | organisation home stat cards |
| `GET /org/patients/:karevoId` | search: returns name and whether a profile exists, nothing more |
| `POST /org/consent-requests` `{karevoId, scope[], purpose, requestedDays}` | `RequestForm` |
| `GET /org/consent-requests?status=` | requests list |
| `GET /org/consent-requests/:id/records` | `RecordViewer`: records covered by an active consent, writes `RecordAccessEvent` |
| `POST /org/visits` `{qrCode}` | `ScanPatientQrModal` (Q2) |
| `GET /org/patients/:karevoId/records` | patient page: needs an active consent or visit grant, writes `RecordAccessEvent` |
| `POST /org/patients/:karevoId/records` | `UploadRecordModal`, text only (Q5); org must be `verified` |
| `GET /org/activity` | activity page |
| `GET /org/members`, `POST /org/members` (invite), `DELETE /org/members/:id` | Users and Team pages (admin role) |
| `GET /org/profile`, `PATCH /org/profile` | admin › Settings (admin role) |

### Admin API: needed for the beta

| Endpoint | Role | Purpose |
| --- | --- | --- |
| `POST /admin/auth/login`, `2fa/verify`, `refresh`, `logout` | all | MFA login |
| `POST /admin/orgs` | super_admin, ops_support | create an organisation and invite its first admin |
| `GET /admin/orgs?status=`, `GET /admin/orgs/:id` | super_admin, ops_support | org list and detail |
| `POST /admin/orgs/:id/approve`, `reject`, `suspend`, `reinstate` `{reasonCode, note}` | super_admin, ops_support | verification queue |
| `GET /admin/users/:karevoId` | super_admin, ops_support | account metadata only, no record contents |
| `POST /admin/users/:id/nin/verify` `{reasonCode, note}` | super_admin, ops_support | **manual NIN verification**, which replaces the stub in production |
| `GET /admin/audit/record-access`, `GET /admin/audit/admin-actions` | super_admin, compliance_officer | audit log viewer |
| `GET /admin/consents?status=` | super_admin, compliance_officer | consent monitor |
| `GET /admin/overview` | all | KPI cards |

### Patient API additions

- `POST /me/visit-qr`: creates the signed QR for in-person visits (Q2).
- Organisation and admin record reads now appear in `GET /me/activity`.

### After the beta

These are in the admin spec, but neither frontend has finished screens for them yet:

- data-subject requests (export and erasure), security alerts, anomaly flags
- freezing accounts with four-eyes approval (a second admin must confirm)
- support tickets, feature flags, consent and terms versioning, broadcasts
- doctor credentials, file uploads, organisation-registered patients (Q3)

In `karevo-admin`, the Orgs & Doctors, Users and Support pages are still placeholders. The Records and Compliance pages are built against mock data.

## 6. Build order

| Step | Contents | Unblocks |
| --- | --- | --- |
| 0 | Fix the Render start command; add `GET /health`, `render.yaml`, and `npm start` → `node dist/main` | a working deploy |
| 1 | The three login realms: tables, guards, separate secrets, cross-realm tests | everything below |
| 2 | Admin: login with MFA, create, approve and suspend organisations, manual NIN verification, `NIN_PROVIDER=manual` | production start, onboarding |
| 3 | Organisation: invites, login, profile, members, patient lookup, consent requests and consented record reads with access events | the core beta loop |
| 4 | Organisation record upload (text); patient visit QR and organisation visit grant | in-person flow |
| 5 | Admin: audit viewers, consent monitor, overview | compliance |
| 6 | Wire the three frontends to the API | the beta itself |

Steps 1–3 are the minimum for a beta where an organisation can request and read a real patient's records. As a rough estimate for one engineer: step 1 takes 1 day, step 2 takes 1–1.5 days, step 3 takes 2 days, step 4 takes 1 day and step 5 takes 1 day, plus frontend wiring. Splitting steps 2–5 across engineers after step 1 is in place shortens this considerably.

## 7. Seeding for the beta

The seed script gains one verified organisation, one organisation admin and one member (with an invite already accepted), one super admin (whose TOTP secret is printed once to the console), plus cross-linked consents and records. Then all three dashboards can be demonstrated together locally.

Production gets **no seed**. The first super admin is created with a one-off command, `npm run admin:create -- --email …`.
