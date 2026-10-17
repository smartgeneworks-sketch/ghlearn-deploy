# SMS (BMS Africa / mNotify)

GH Learn sends SMS through the BMS Africa (mNotify) v2 API (`https://api.mnotify.com/api`).

## Configuration (environment only)
| Variable | Purpose |
|---|---|
| `BMS_API_KEY` | API key. **Only** an environment variable on the API host (Render). It is never stored in the database, shown in the UI, logged or committed. Errors from the provider are scrubbed of the key. |
| `SMS_SENDER_ID` | Default sender ID (approved by BMS, max 11 chars), e.g. `GHLearn`. A Super Admin can override it in System settings → SMS. |
| `SMS_PROVIDER` | Optional: `mnotify` (default when a key is set) or `test` (in-memory fake, only under `NODE_ENV=test`). |
| `SMS_API_BASE` | Optional API base URL. |

Under `NODE_ENV=test` (unit tests, E2E server) the real provider is never used, even if a key is present.

## Features
- **Phone numbers** (Account page): Ghana mobiles (MTN 024/025/053/054/055/059, Telecel 020/050, AirtelTigo 026/027/056/057), stored as `0XXXXXXXXX`, shown as `+233…` where needed. Verified with a 6-digit code: HMAC-hashed with a server secret, 10 minutes, 5 attempts, single use; limits 3 codes/user/hour, 3 codes/number/hour, 10 requests/IP/15 min. A verified number belongs to one account.
- **Forgot password by SMS**: `/forgot-password` accepts an email or a verified phone. A 12-character single-use code (same grant machinery as email links: hashed, 30 minutes, revokes all sessions on use) is sent with `sms_type: "otp"`. The response is identical whether or not an account matches; the per-IP and per-account (3/hour) limits apply. `GET /api/settings/public` → `passwordReset.sms` is true when SMS is usable.
- **Meeting texts** (opt-in, Account page): requested, accepted, declined, rescheduled, and a reminder about an hour before (job `meeting.reminders`, every 15 minutes, once per meeting; rescheduling re-arms it). Verified numbers only; one 160-character segment, starting "GH Learn:". Delivery status is recorded on each notification (`delivery.sms`).
- **Admin** (Super Admins, System settings → SMS): on/off, sender ID, daily cap (default 300/day UTC; saved through the audited `PATCH /api/admin/settings`), live balance and sender status, test send to a number of the admin's choice (audited `sms.test`), the last N sends (masked numbers, no message text, delivery check), sender ID registration (audited).
- **Log**: `SmsLog` (180-day TTL) keeps kind, masked number, network, status, provider campaign id, credits, delivery. Message bodies and codes are never stored.

## Costs
Each SMS uses mNotify credits (one per 160-character segment and recipient); `sms_type: "otp"` messages carry the provider's OTP rate (GHS 0.035). The daily cap bounds spend.

## API
- `GET/POST/DELETE /api/account/phone`, `POST /api/account/phone/verify` (signed in)
- `GET /api/admin/sms/status`, `POST /api/admin/sms/test`, `GET /api/admin/sms/log?limit=`, `POST /api/admin/sms/log/:id/delivery`, `POST /api/admin/sms/sender/register` (platform:manage)

## Email test send
`GET /api/admin/email/status`, `POST /api/admin/email/test { to }` (platform:manage; audited `email.test` with a masked address and the provider message id). In the UI: System settings → SMS and email → "Send a test email". Email itself is configured with `EMAIL_API_PROVIDER=brevo`, `EMAIL_API_KEY`, `EMAIL_FROM` (see docs/PASSWORD_RESET.md).
