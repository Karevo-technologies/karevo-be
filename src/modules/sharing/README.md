# Sharing module

Users share identity data in two ways: a one-off **share token** (`XXXX-XXXX`), or by **scanning** an organisation's QR code.

| Endpoint | State | UI |
| --- | --- | --- |
| `POST /share-tokens` | stubbed | Create share token |
| `GET /share-tokens?active=true` | stubbed | active tokens list (not built in the UI yet) |
| `DELETE /share-tokens/:id` | stubbed | Revoke Now |
| `POST /scan/resolve {payload}` | stubbed | QR scan (placeholder page in the UI) |
| `POST /scan/:requestId/confirm {categories}` | stubbed | QR scan confirm |

Creating a token and both scan routes use `@RequireVerifiedNin()`. Token creation is limited to 20 per hour.

## Create token

1. Generate `code = crypto.shareCode()`. It comes from a CSPRNG; the frontend's `Math.random()` code must go.
2. Store `codeHash = crypto.blindIndex(code)`. On a unique-constraint collision, generate a new code and retry, up to 3 times.
3. Set `expiresAt` from `expiry`: `1h`, `24h` or `7d` from now. For `single`, set it to `null`; the token lives until first use.
4. Convert `expiry` with `EXPIRY_TO_DB`, because the Prisma enum keys are `h1`, `h24`, `d7` and `single`.
5. Record a `create` event "Share token created".
6. Return `201` with the view **including `code`**. This is the only time the code is returned (D-07).

## List tokens

- Scope to the user, newest first, paginated.
- With `active=true`, add `revokedAt: null, usedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]`.
- Never include `code`. Convert `expiry` back with `EXPIRY_FROM_DB`.

## Revoke token

- `updateMany({ where: { id, userId: me.id, revokedAt: null }, data: { revokedAt: now } })`.
- If the count is 0, return `404`, whether the token doesn't exist, belongs to someone else or is already revoked.
- Record an event and respond `204`.

## QR scan

The QR payload format is an **open question in the spec**. The intended design (Proposed):

- An organisation creates a `ScanRequest` through the organisation API, with `requestedCategories` and a short expiry (5 minutes).
- The QR encodes a compact signed string: `kv1.<scanRequestId>.<HMAC-SHA256(scanRequestId, org key)>`. A signature stops users from being sent to forged requests.
- `resolve`:
  1. Parse and verify the payload.
  2. Load the request. It must be unexpired and unconfirmed. If its `userId` is already set to someone else, return `409`.
  3. Set `userId = me.id`.
  4. Return the `org`, `requestedCategories` and `requestId`.
- `confirm`:
  1. The request must belong to `me.id`, be unexpired and unconfirmed.
  2. `categories` must be a subset of `requestedCategories`; otherwise return `400`.
  3. Set `grantedCategories` and `confirmedAt`.
  4. Record a `consent` event and respond `204`.

Once the payload format is agreed, record it as a new entry in `docs/DECISIONS.md`.
