# Records module

Health records uploaded by hospitals, labs and insurers. This module is **read-only**: the UI states records cannot be edited or downloaded, so users have no write endpoints. The organisation API creates records.

| Endpoint | State | UI |
| --- | --- | --- |
| `GET /records?q=&type=&cursor=&limit=` | stubbed | records list |
| `GET /records/:id` | stubbed | record detail |

The response shape is `RecordView` in `dto/records.dto.ts`.

## List

- `where: { userId: me.id }`, ordered by `receivedAt desc, id desc`. Use `pageArgs(query)` and `toPage(...)` from `src/common/pagination`.
- `q`: case-insensitive `contains` across `type`, `summary` and `issuedBy.name`. `details` is encrypted, so it can't be searched; that's acceptable for now.
- `type`: exact match on `type`.
- Include `issuedBy: { select: { id, name } }`.
- Leave `details` out of list items (D-16).
- Return `issuedDate` as `YYYY-MM-DD` and `receivedAt` as a full ISO timestamp.

## Detail

- `findFirst({ where: { id, userId: me.id } })`. If nothing matches, return `AppException.notFound('Record')`, whether the record doesn't exist or belongs to someone else.
- Return the full view with `details: crypto.decrypt(row.detailsEnc)`.
- Set `Cache-Control: no-store`.

## Notes

- `category` (D-06) tells you which consent scope covers a record. Users don't need it here, but the organisation API does.
- Viewing a record is not logged. Only writes are logged.
