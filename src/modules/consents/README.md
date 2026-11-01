# Consents module

Organisations' requests to see a user's records. One table, `ConsentRequest`: the pending, active and history tabs are all views of `status`.

| Endpoint | State | UI |
| --- | --- | --- |
| `GET /consents?status=pending\|active\|history` | stubbed | consents tabs, home Pending Requests |
| `GET /consents/:id` | stubbed | consent dialog |
| `POST /consents/:id/approve {days}` | stubbed | Grant access dialog |
| `POST /consents/:id/decline {note?}` | stubbed | Decline |
| `POST /consents/:id/revoke {note?}` | stubbed | Revoke on the active tab |

The three actions use `@RequireVerifiedNin()` (D-15). The response shape is `ConsentView` in `dto/consents.dto.ts`, and it includes the `org`.

## Status changes

```
pending ──approve──▶ active ──revoke──▶ revoked
   │                   │
   └──decline──▶ declined   └──(ExpiryJob at expiresAt)──▶ expired
```

Any other change is a `409 CONFLICT`.

## List

- `pending`: `status = pending`, newest `requestedAt` first.
- `active`: `status = active` and `expiresAt > now`, soonest expiry first. The extra `expiresAt` check hides consents the expiry job hasn't swept yet.
- `history`: `status in (declined, revoked, expired)`, newest `resolvedAt` first (D-17).
- Paginate with `pageArgs` and `toPage`.
- Don't add `daysLeft`: the client computes it from `expiresAt`.

## Detail

`findFirst({ where: { id, userId: me.id }, include: { org: true } })`. Return `404` if nothing matches.

## Approve

All of this in one `$transaction`:

1. Load the consent scoped to the user (`404` if missing).
2. If it isn't `pending`, return `409 CONFLICT` "This request is no longer pending".
3. Update it, using a conditional update so two concurrent approvals can't both win: `updateMany({ where: { id, status: 'pending' }, ... })`. If the count is 0, return `409`. Set:
   - `status = active`
   - `grantedDays = dto.days`
   - `grantedAt = now`
   - `expiresAt = now + days`
   - `resolvedAt = now`
4. Record a `consent` event "Granted <org> access for <n> days".

`days` may be less than `requestedDays`; that's allowed. The UI already warns the user when the two differ.

## Decline

Same pattern: only from `pending`. Set `status = declined`, `resolvedAt` and `note`, and record the event "Declined <org>".

## Revoke

- Only from `active` with `expiresAt` in the future; anything else is a `409`.
- Set `status = revoked`, `resolvedAt` and `note`, and record the event "Revoked <org>'s access".
- Access ends immediately, because organisations' reads check `status = active`.

## Expiry

`src/jobs/expiry.job.ts` is already done. Every 5 minutes it marks consents past `expiresAt` as `expired` and logs a `consent` event for each one.
