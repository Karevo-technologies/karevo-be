# Settings & security module

Preferences, linked IDs, devices and sessions, the activity log and the integrity score. Every route is under `/me`.

| Endpoint | State | UI |
| --- | --- | --- |
| `GET /me/preferences` | stubbed | notifications, offline, settings |
| `PATCH /me/preferences` | stubbed | every switch on those pages |
| `GET /me/linked-ids` | stubbed | linked IDs |
| `GET /me/sessions` | stubbed | Devices modal, profile Sessions |
| `DELETE /me/sessions/:id` | stubbed | Remove device |
| `DELETE /me/sessions?except=current` | stubbed | Sign out other sessions |
| `GET /me/activity?kind=&cursor=` | stubbed | Security page, home Recent Activity |
| `GET /me/integrity` | stubbed | security seal (hard-coded to 92 in the UI today) |

## Preferences

- `GET`: `preferences.upsert({ where: { userId }, create: { userId }, update: {} })`, so older accounts get the defaults.
- `PATCH`: update only the fields that were sent and return the full object.
- This is the single source of truth for notification switches. The profile page and the settings page both have them and must both call this endpoint.
- `autoSignOutMinutes` is enforced on the server by `SessionService` (D-12). `0` turns it off.

## Linked IDs

- List the user's `LinkedId` rows as `{ id, type, numberMasked: '*******' + numberLast4, status }`.
- The NIN row is created at registration (D-18).
- Adding other ID types (passport, driver's licence, voter's card) needs an answer to the open question "user upload, or verified by a provider?". No endpoint exists for it yet.

## Sessions

- **List:** sessions with `userId = me.id`, `revokedAt: null` and `expiresAt > now`, most recent `lastActiveAt` first. Set `current: row.id === me.sessionId`. Never return `refreshTokenHash`, `ip` or `userAgent`.
- **Remove a device:** inject `SessionService`, which `AuthModule` exports.
  - Check the session belongs to the user; otherwise return `404`.
  - Removing the current session is allowed; it signs the user out.
  - Call `sessions.revoke(id)`, then record an `auth` event "Device removed: <deviceName>".
- **Sign out other sessions:** `updateMany({ where: { userId, revokedAt: null, id: { not: me.sessionId } }, data: { revokedAt: now } })`, then record one event.
- Revocation takes effect immediately, because `JwtAuthGuard` checks the session on every request.

## Activity

- `where: { userId, kind? }`, ordered by `occurredAt desc, id desc`, paginated.
- Return `ActivityView`, which leaves out `metadata`.
- The home Recent Activity panel uses `limit=5`.

## Integrity

The Integrity Index calculation is an **open question in the spec**. Until someone defines it, the suggested factors are:

| Factor | Points |
| --- | --- |
| NIN verified | 30 |
| 2FA on | 25 |
| PIN set | 15 |
| No failed sign-in in the last 30 days | 15 |
| Sessions active in the last 30 days ≤ 3 | 15 |

Return `{ score, factors: [{ key, label, ok }] }`. Record the final formula in `docs/DECISIONS.md` once it is agreed.
