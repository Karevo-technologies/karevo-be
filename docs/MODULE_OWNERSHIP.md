# Module ownership

The code is split so that each engineer owns one module and rarely has to edit anyone else's files. Each module's `README.md` is its brief. Every endpoint is now implemented, so `git grep -n "notImplemented("` finds only the helper itself in `src/common/stub.ts`.

| Module | Folder | Endpoints | State | Main dependencies |
| --- | --- | --- | --- | --- |
| Auth | `src/modules/auth` | 7 | done | — |
| Account | `src/modules/account` | 11 | done | `DataExportJob` |
| Records | `src/modules/records` | 2 | done | — |
| Consents | `src/modules/consents` | 5 | done | `ExpiryJob` (done) |
| Sharing | `src/modules/sharing` | 6 | done, including `POST /me/visit-qr` (D-28) | — |
| Settings & security | `src/modules/settings` | 8 | done | `SessionService` from Auth |
| Organisation | `src/modules/org` | 22 | done | `common/sessions`; consents and sharing for records and visits |
| Admin | `src/modules/admin` | 19 | done | `common/sessions`; the NIN job (`NIN_PROVIDER=manual`) |
| Health | `src/health` | 1 | done | — |

## Shared code: change with care

These folders are used by every module. Changes go through review by whoever owns the platform, and the wiring test (`src/app.wiring.spec.ts`) must keep passing.

| Folder | What it provides |
| --- | --- |
| `src/common/errors` | `AppException`, `ErrorCode`, the global error filter |
| `src/common/auth` | `@Public()`, `@RequireVerifiedNin()`, `@CurrentUser()`, `RequestUser`, realm helpers (`realm.ts`) |
| `src/common/validation` | validation pipe, shared rules (NIN, PIN, password, consent days), transforms |
| `src/common/pagination` | `CursorQueryDto`, `pageArgs()`, `toPage()` |
| `src/common/throttle` | throttler guard and per-route `LIMITS` |
| `src/common/sessions` | refresh-session store and realm cookies, shared by the patient, organisation and admin logins (D-22) |
| `src/crypto` | encryption, blind index, Argon2id, codes and IDs |
| `src/activity` | `ActivityService.record()`: the patient activity log every write must call |
| `src/modules/admin/admin-audit.service.ts` | `AdminAuditService.log()`: the append-only admin action log (D-27, D-30) |
| `prisma/schema.prisma` | the data model; schema changes need a migration in the same PR |

## Rules for every module

1. **Scope every query to the caller.** Put `userId: me.id` (or `orgId: me.orgId` in the organisation API) in every `where`. When a row is missing or belongs to someone else, throw `AppException.notFound()`, so the response never reveals which.
2. **Log every write.** Writes to records, consents, tokens, sessions and the PIN call `ActivityService.record()`. Pass the transaction client so the event commits with the change. Admin state changes also need a `reasonCode` and an `AdminAuditService.log()` call in the same transaction.
3. **Return ISO timestamps.** Never return relative strings like "2 hours ago"; the UI formats times itself.
4. **Never return secrets.** No `*Enc` or `*Hash` column leaves the service. Map rows to the `*View` interface in the module's DTO file.
5. **Validate in DTOs.** Repeat the client's rules on the server using `src/common/validation/rules.ts`.
6. **Test what you build.** Write unit tests for the service logic, and add a case to the wiring test for any new guard or validation behaviour.
