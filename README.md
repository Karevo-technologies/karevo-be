# karevo-be

The API for the **Karevo users dashboard** (`karevo-users-dashboard`): the patient-facing side of Karevo, where users view their health records, manage organisations' consent requests, share their data and secure their account.

It implements the *Karevo Users Dashboard — Backend Technical Spec* (Oct 28, 2026). Where the code departs from or adds to the spec, the change is recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

**Stack:** NestJS 11 · TypeScript (strict) · PostgreSQL · Prisma 6 · `@nestjs/schedule` · Argon2id · Jest

## Status

This is a **scaffold to be split across engineers**:

- **Done:** auth (register, login, refresh with rotation, logout), sessions, the error format, validation, guards, rate limits, encryption, the audit log, the consent expiry job, the NIN verification job (with a stub provider), and `GET /me`.
- **Stubbed:** every other endpoint is routed and validated and has Swagger docs, but returns `501 NOT_IMPLEMENTED`. Its module README explains what to build.

See [docs/MODULE_OWNERSHIP.md](docs/MODULE_OWNERSHIP.md) for who owns what.

## Getting started

Requires Node 20 or later and PostgreSQL 15 or later.

**1. Install dependencies and create your environment file**

```sh
npm install
cp .env.example .env
```

**2. Fill in the two encryption keys in `.env`**

Run this twice, once for `DATA_ENCRYPTION_KEY` and once for `BLIND_INDEX_KEY`:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Also set `JWT_ACCESS_SECRET` to a long random string.

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

The API is at `http://localhost:4000/api/v1` and Swagger is at `http://localhost:4000/api/docs`. Swagger is not served in production.

**Demo login** (from the seed):

| Field | Value |
| --- | --- |
| Email | `demo@karevo.ng` |
| Password | `KarevoDemo#2026` |
| NIN | `12345678901` |

## Scripts

| Script | What it does |
| --- | --- |
| `npm run start:dev` | run with watch |
| `npm run build` / `start:prod` | compile to `dist/` / run the compiled app |
| `npm test` | unit tests and the app wiring test; no database needed |
| `npm run lint` | type-check only |
| `npm run prisma:migrate` | create and apply a migration after you edit `schema.prisma` |
| `npm run db:seed` | reset the demo user's data |

## Layout

```
prisma/              schema, migrations, seed
src/
  main.ts            bootstrap and Swagger
  app.setup.ts       prefix, CORS, helmet, cookies, validation (shared with tests)
  config/env.ts      environment schema, validated at startup
  common/            errors, auth decorators, validation, pagination, throttling
  crypto/            AES-256-GCM, blind index, Argon2id, codes
  activity/          audit log writer
  prisma/            PrismaService
  jobs/              consent expiry, NIN verification, data export
  modules/
    auth/ account/ records/ consents/ sharing/ settings/   (each with a README.md)
docs/
  DECISIONS.md       gaps in the spec and how they were filled
  MODULE_OWNERSHIP.md
```

## Notes for the frontend

- **Base URL:** `VITE_API_BASE_URL=http://localhost:4000/api/v1`. Add the dashboard's origin to `CORS_ORIGINS`.
- **Credentials:** send every request with `credentials: 'include'`, so the refresh cookie travels with it.
- **Deployment:** in production the API and the dashboard must share a registrable domain, for example `api.karevo.ng` and `app.karevo.ng` (D-14).
- **Errors:** every error has the shape `{ error: { code, message, fields? } }`. Show `message`, and map `fields` onto form inputs.
- **Handling 401s:**
  - `TOKEN_EXPIRED`: call `POST /auth/refresh` once, then retry the request.
  - `UNAUTHENTICATED`: go to `/login`.
  - Run only **one refresh at a time**. Concurrent refreshes look like token theft and end the session (D-13).
- **Login with 2FA:** login can return `{ twoFactorRequired: true, challengeToken }` instead of tokens. In that case, finish with `POST /auth/2fa/verify` (D-01).
- **Page load:** call `POST /auth/refresh`, then `GET /me`.
