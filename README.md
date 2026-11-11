# karevo-be

The API behind Karevo's three dashboards. Each dashboard has its own login realm (D-22):

| Dashboard | Repo | API paths | Who uses it |
| --- | --- | --- | --- |
| Users | `karevo-users-dashboard` | `/api/v1/auth`, `/api/v1/me`, … | patients: health records, consent requests, sharing, account security |
| Organisations | `karevo-doctors-dashboard` | `/api/v1/org` | hospitals, clinics, labs, schools and insurers ([module README](src/modules/org/README.md)) |
| Admin | `karevo-admin` | `/api/v1/admin` | Karevo staff: onboarding, verification, audit ([module README](src/modules/admin/README.md)) |

The patient API implements the *Karevo Users Dashboard — Backend Technical Spec* (Oct 28, 2026). The organisation and admin APIs follow [docs/ORG_AND_ADMIN_PLAN.md](docs/ORG_AND_ADMIN_PLAN.md). Where the code departs from or adds to a spec, the change is recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

**Stack:** NestJS 11 · TypeScript (strict) · PostgreSQL · Prisma 6 · `@nestjs/schedule` · Argon2id · Jest

## Status

Every endpoint in the three APIs is implemented. What's left before launch:

- **Frontends:** wire the three dashboards to the API (plan step 6). Each module README lists the changes its dashboard needs.
- **Before launch:** organisation staff 2FA and password reset (D-25), invite emails (D-26), a NIN vendor (D-24), and a non-owner database role for the app (D-27).
- **Not in the beta:** the post-beta admin features listed in the [admin README](src/modules/admin/README.md#not-built-yet).

See [docs/MODULE_OWNERSHIP.md](docs/MODULE_OWNERSHIP.md) for who owns what.

## Getting started

Requires Node 20 or later and PostgreSQL 15 or later.

**1. Install dependencies and create your environment file**

```sh
npm install
cp .env.example .env
```

**2. Fill in the secrets in `.env`**

Run this twice, once for `DATA_ENCRYPTION_KEY` and once for `BLIND_INDEX_KEY`:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Also set `JWT_ACCESS_SECRET` and `JWT_ADMIN_SECRET` to two **different** long random strings.

**3. Start Postgres**

Either run it in Docker:

```sh
docker compose up -d
```

Or use a local install. Create a `karevo` role and database, and point `DATABASE_URL` at them.

**4. Create the tables and load the demo data**

```sh
npx prisma migrate deploy
npm run db:seed
```

**5. Run the API**

```sh
npm run start:dev
```

The API is at `http://localhost:4000/api/v1`, and the health check is at `/api/v1/health`. Swagger is at `http://localhost:4000/api/docs`; it isn't served in production.

**Demo logins** (from the seed):

| Dashboard | Email | Password |
| --- | --- | --- |
| Users | `demo@karevo.ng` (NIN `12345678901`) | `KarevoDemo#2026` |
| Organisations (admin) | `org.admin@karevo.test` | `KarevoOrg#2026` |
| Organisations (member) | `org.member@karevo.test` | `KarevoOrg#2026` |
| Admin (super admin) | `super.admin@karevo.test` | `KarevoAdmin#2026` |

The demo super admin sets up an authenticator app at first sign-in (D-23). To create a real admin:

```sh
npm run admin:create -- --email <email> --name "<name>" --role super_admin
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run start:dev` | run with watch |
| `npm run build` | compile to `dist/` |
| `npm start` | run the compiled app (`node dist/main`) |
| `npm run start:prod` | apply migrations, then run the compiled app |
| `npm test` | unit tests and the app wiring test; no database needed |
| `npm run lint` | type-check only |
| `npm run prisma:migrate` | create and apply a migration after you edit `schema.prisma` |
| `npm run db:seed` | reset the demo data for all three dashboards |
| `npm run admin:create` | create a Karevo admin; prints a one-time password |

## Layout

```
prisma/              schema, migrations, seed
scripts/             create-admin.ts
src/
  main.ts            bootstrap and Swagger
  app.setup.ts       prefix, CORS, helmet, cookies, validation (shared with tests)
  config/env.ts      environment schema, validated at startup
  common/            errors, auth decorators, validation, pagination, throttling, realm sessions
  crypto/            AES-256-GCM, blind index, Argon2id, codes
  activity/          audit log writer
  prisma/            PrismaService
  health/            GET /health
  jobs/              consent expiry, NIN verification, data export
  modules/
    auth/ account/ records/ consents/ sharing/ settings/   patient API
    org/                                                    organisation API
    admin/                                                  admin API
                     (each module has a README.md)
docs/
  DECISIONS.md            gaps in the specs and how they were filled
  MODULE_OWNERSHIP.md
  ORG_AND_ADMIN_PLAN.md   scope and build order for the org and admin APIs
render.yaml          Render deployment blueprint
```

## Deployment

`render.yaml` describes the Render service. It builds once, runs `prisma migrate deploy` at start, then runs `node dist/main`. Render checks `/api/v1/health` (D-31). Secrets are entered in the Render dashboard, not in the file.

Production sets `NIN_PROVIDER=manual` (D-24): the stub provider refuses to start in production, and admins verify NINs until a vendor is integrated.

## Notes for the frontends

These notes are written for the users dashboard. The organisation and admin dashboards work the same way with their own paths and cookies; their module READMEs list the differences.

- **Base URL:** `VITE_API_BASE_URL=http://localhost:4000/api/v1`. Add each dashboard's origin to `CORS_ORIGINS`.
- **Credentials:** send every request with `credentials: 'include'`, so the refresh cookie travels with it.
- **Deployment:** in production the API and the dashboards must share a registrable domain, for example `api.karevo.ng` and `app.karevo.ng` (D-14).
- **Errors:** every error has the shape `{ error: { code, message, fields? } }`. Show `message`, and map `fields` onto form inputs.
- **Handling 401s:**
  - `TOKEN_EXPIRED`: call `POST /auth/refresh` once, then retry the request.
  - `UNAUTHENTICATED`: go to `/login`.
  - Run only **one refresh at a time**. Concurrent refreshes look like token theft and end the session (D-13).
- **Login with 2FA:** login can return `{ twoFactorRequired: true, challengeToken }` instead of tokens. In that case, finish with `POST /auth/2fa/verify` (D-01).
- **Page load:** call `POST /auth/refresh`, then `GET /me`.
