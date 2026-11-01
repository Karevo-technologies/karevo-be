# Account module

This module covers the user's own account: profile, password, PIN, 2FA, deactivation, data export, the home summary and the ID card. Every route is under `/me` and needs a bearer token.

| Endpoint | State | UI |
| --- | --- | --- |
| `GET /me` | done | top bar, home banner, ID card |
| `PATCH /me` | stubbed | profile |
| `PUT /me/password` | stubbed | profile > Change password |
| `PUT /me/pin` | stubbed | settings > PIN modal |
| `POST /me/pin/verify` | stubbed | app unlock, offline sharing |
| `PUT /me/2fa` | stubbed | profile > 2FA switch |
| `POST /me/2fa/confirm` | stubbed | profile > 2FA setup |
| `POST /me/deactivate` | stubbed | profile > Deactivate |
| `POST /me/export` | stubbed | settings > privacy rights |
| `GET /me/summary` | stubbed | home stat cards |
| `GET /me/id-card` | stubbed | Karevo ID card |

Return users through `toUserView()` (`src/common/presenters/user.presenter.ts`), which masks the NIN.

## PATCH /me

- Update `name` only. Email and NIN changes are out of scope for now.
- Return the updated user through `toUserView`.
- Record an `auth` event "Profile updated".

## Password

- Verify `currentPassword` with `crypto.verifySecret`. If it is wrong, return `400 VALIDATION_FAILED` with `fields.currentPassword`. Don't return `401`: the client would treat that as an expired session.
- Check the new password against `isBreachedPassword` (in the auth module).
- Hash it with `crypto.hashSecret` and save it.
- Revoke every session except `me.sessionId`.
- Record an `auth` event "Password changed".
- Respond `204`.

## PIN

See D-02.

`setPin`:

- If `user.pinHash` is set, require `currentPin` and check it against the hash. Wrong attempts count toward the lock described under `verifyPin`.
- If no PIN is set yet, require `password` instead.
- Reject a trivial PIN (`isTrivialPin`) with `400` and `fields.newPin`.
- Store `crypto.hashSecret(newPin)` and record an `auth` event "PIN changed".

`verifyPin`:

- If `pinLockedUntil` is in the future, return `423 ACCOUNT_LOCKED`.
- On a wrong PIN, increment `pinFailedCount`. At 5, set `pinLockedUntil` to now + 15 minutes, reset the count, and record an event. Return `400` with `fields.pin`.
- On success, reset the count and respond `204`.

## 2FA

See D-01.

- `PUT /me/2fa {enabled: true}`: generate a TOTP secret, store it encrypted in `twoFactorSecretEnc`, and return `{ enabled: false, setupUri: "otpauth://totp/Karevo:<email>?secret=…&issuer=Karevo" }`.
- `POST /me/2fa/confirm {code}`: check the code against the stored secret, set `twoFactorEnabled = true`, and record an event.
- `PUT /me/2fa {enabled: false}`: before disabling, require proof of the second factor. Add a `code` or `password` field to `SetTwoFactorDto`. Then clear the secret and the flag.

## Deactivate

- Verify the password (`400` with `fields.password` if wrong).
- Set `deactivatedAt` and revoke all sessions.
- Record an event and respond `204`. The guard and login already refuse deactivated users.
- Not decided yet: how long deactivated accounts are kept before data is deleted (NDPA).

## Export

- Create a `DataExportJob` with status `queued` and return `{ jobId }` (the controller sends `202`).
- Refuse a second request while one is `queued` or `processing`: return `409`.
- `src/jobs/data-export.job.ts` does the work. Its format and delivery are an open question in the spec.

## Summary

One `Promise.all` of counts, all scoped to `userId`:

- `totalRecords`: `healthRecord.count`
- `pendingRequests`: consents with status `pending`
- `activeConsents`: consents with status `active` and `expiresAt` in the future
- `declined`: consents with status `declined`

## ID card

- Return `{ karevoId, name, nin: crypto.decrypt(user.ninEnc), ninStatus }`.
- This is the only response that carries the full NIN (D-05).
- Add `Cache-Control: no-store` to the response.
