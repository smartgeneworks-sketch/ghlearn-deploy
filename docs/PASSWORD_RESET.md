# Password reset and recovery

## Features
| Feature | Who | Where | Notes |
|---|---|---|---|
| Change password (signed in) | everyone | `/account` (header "Account"); admins also in Admin → Account settings | Current password + new one (policy: 10+ chars, a letter and a number). Other sessions signed out; audited `auth.password.change`; in-app notice. |
| Forgot password (self-service) | anyone | Sign in → "Forgot password?" → `/forgot-password` | Only when an email provider is configured (`passwordReset.email` in `GET /api/settings/public`). Otherwise the page says plainly that email reset is unavailable and to ask a teacher or school admin. |
| Reset with link | link holder | `/reset-password?token=…` | Token removed from the address bar on load. Sets the password, clears lockout and any forced change, revokes all sessions, voids other grants, in-app notice, audited `auth.password.reset`. |
| Reset with code | student + staff code | `/reset-password` (no token) | Account email + 12-character code (staff-issued only). 5 wrong codes void the grant. |
| Staff reset link + code | super admin (anyone except other platforms' rules below), school admin (non-admin members of own school), teacher (students in classes they teach) | Admin → Users → user → "Security and recovery"; Teach → class → student → "Password help" | Shown once, valid 24 h. Audited `user.password.reset_link`; user notified in-app. |
| Staff temporary password | same scope | same places | Shown once; forced change at next sign-in; all sessions revoked; outstanding links voided. Audited `user.password.reset`. |

Scope rules: nobody resets their own account through staff tools; school admins cannot touch administrator/platform accounts or
other schools (404); teachers only reach users who are students and nothing else, in a class they teach; counsellors, editors
and students have no staff reset.

## Security design
- Token: 32 random bytes (base64url), stored only as SHA-256 (`PasswordReset.tokenHash`); code stored only as SHA-256. Raw values exist once (email / staff screen) and are redacted from audit logs.
- Single use: redemption claims the grant atomically (`usedAt`), so a second use fails. New grants void earlier unused grants of the same kind.
- Lifetimes: self-service `PASSWORD_RESET_MINUTES` (default 30); staff `STAFF_RESET_HOURS` (default 24). Records are removed by a TTL index 7 days after expiry.
- Rate limits: per IP — forgot 5 / 15 min, reset 10 / 15 min (429); per account — 3 self-service requests per hour (extra requests silently dropped, audited `account_rate_limited`).
- Enumeration-safe: forgot-password returns the same body for every input and does the lookup/sending after the response; failed lookups are audited without the submitted address.
- Cookies/CSRF: all routes sit behind the existing double-submit CSRF check; reset clears auth cookies.

## Email service (`server/src/services/mailer.ts`)
Provider-independent; first configured adapter wins:
1. SMTP — `SMTP_URL`, or `SMTP_HOST` + `SMTP_PORT` (+ `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`).
2. HTTP API — `EMAIL_API_PROVIDER=brevo|resend` + `EMAIL_API_KEY`.
Both need `EMAIL_FROM`, e.g. `GH Learn <no-reply@ghlearn.com>`. Nothing configured → `not_configured`; nothing pretends to send.

**Render free plan blocks outbound SMTP (ports 25/465/587), so use the HTTP API adapter there.**

### Switching on email reset (recommended: Brevo, free 300 emails/day)
1. Create a free Brevo account at https://www.brevo.com (no card needed).
2. Brevo → Settings → Senders, Domains & Dedicated IPs → Domains → Add a domain: `ghlearn.com`; choose to authenticate it yourself.
3. Brevo shows DNS records (a `brevo-code` TXT, DKIM CNAME/TXT records, and a DMARC TXT). In Namecheap → Domain List → ghlearn.com → Manage → Advanced DNS → Add New Record, add each one exactly as shown (Host = the part before `.ghlearn.com`, e.g. `brevo1._domainkey`; for the domain itself use `@`). Keep existing records. If a `_dmarc` TXT already exists, keep just one.
4. Back in Brevo click Verify / Authenticate (DNS can take up to a few hours) until DKIM and DMARC show green.
5. Brevo → Senders → Add sender `no-reply@ghlearn.com`, name `GH Learn`.
6. Brevo → SMTP & API → API keys → Generate a new API key (an API key, not the SMTP key). Copy it once.
7. Give the key to the operator, who adds three Render env vars one at a time (never replacing the set):
   `EMAIL_API_PROVIDER=brevo`, `EMAIL_API_KEY=<key>`, `EMAIL_FROM=GH Learn <no-reply@ghlearn.com>`; then redeploys.
8. Check: `GET https://api.ghlearn.com/api/settings/public` shows `"passwordReset":{"email":true,…}`, and "Forgot password?" sends a link.

Alternative: Resend (free 3,000/month, max 100/day): add the domain in Resend, put its SPF/DKIM records (on a `send` subdomain) in
Namecheap, create an API key, set `EMAIL_API_PROVIDER=resend` plus the same `EMAIL_API_KEY`/`EMAIL_FROM`.
