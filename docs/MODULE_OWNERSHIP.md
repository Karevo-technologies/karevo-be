# Module ownership

The scaffold is split so that each engineer owns one module and rarely has to edit anyone else's files. Each row below is one assignment. The module's `README.md` is its brief, and every stubbed method throws `notImplemented('<README anchor>')`.

To see what is left anywhere in the code:

```sh
git grep -n "notImplemented("
```

| Module | Folder | Endpoints | State | Main dependencies |
| --- | --- | --- | --- | --- |
| Auth | `src/modules/auth` | 7 | register, login, refresh and logout done; 2FA verify and password reset stubbed | — |
| Account | `src/modules/account` | 11 | `GET /me` done; the rest stubbed | `DataExportJob` |
| Records | `src/modules/records` | 2 | stubbed | — |
| Consents | `src/modules/consents` | 5 | stubbed | `ExpiryJob` (done) |
| Sharing | `src/modules/sharing` | 5 | stubbed | QR payload decision (open question) |
| Settings & security | `src/modules/settings` | 8 | stubbed | `SessionService` from Auth |

## Shared code: change with care

These folders are used by every module. Changes go through review by whoever owns the platform, and the wiring test (`src/app.wiring.spec.ts`) must keep passing.

| Folder | What it provides |
| --- | --- |
| `src/common/errors` | `AppException`, `ErrorCode`, the global error filter |
| `src/common/auth` | `@Public()`, `@RequireVerifiedNin()`, `@CurrentUser()`, `RequestUser` |
| `src/common/validation` | validation pipe, shared rules (NIN, PIN, password, consent days), transforms |
| `src/common/pagination` | `CursorQueryDto`, `pageArgs()`, `toPage()` |
| `src/common/throttle` | throttler guard and per-route `LIMITS` |
| `src/crypto` | encryption, blind index, Argon2id, codes and IDs |
| `src/activity` | `ActivityService.record()`: the audit log every write must call |
| `prisma/schema.prisma` | the data model; schema changes need a migration in the same PR |

## Rules for every module

1. **Scope every query to the caller.** Put `userId: me.id` in every `where`. When a row is missing or belongs to someone else, throw `AppException.notFound()`, so the response never reveals which.
2. **Log every write.** Writes to records, consents, tokens, sessions and the PIN call `ActivityService.record()`. Pass the transaction client so the event commits with the change.
3. **Return ISO timestamps.** Never return relative strings like "2 hours ago"; the UI formats times itself.
4. **Never return secrets.** No `*Enc` or `*Hash` column leaves the service. Map rows to the `*View` interface in the module's DTO file.
5. **Validate in DTOs.** Repeat the client's rules on the server using `src/common/validation/rules.ts`.
6. **Test what you build.** Write unit tests for the service logic, and add a case to the wiring test for any new guard or validation behaviour.
