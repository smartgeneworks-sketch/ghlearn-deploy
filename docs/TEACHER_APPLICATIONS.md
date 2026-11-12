# Teacher applications and set-password invitations

## Flow
1. **Apply** at `/register/teacher` (linked from /register, the sign-in page and the public "For teachers" page). No password.
   Fields: full name, email, optional Ghana mobile (normalised), region (16), school (pick an active school, or "My school is not listed" + name), subjects (active subjects), forms (JHS 1-3, SHS 1-3), optional staff ID / NTC licence number / note, consent.
2. The reply is always the same ("Thank you. Your application has been received…"). After the response:
   - email already has an account → that address is emailed "you already have an account" (sign in / forgot password); no application;
   - a pending application exists → "we already have your application"; no new one;
   - otherwise the application is stored, a confirmation is emailed (and texted if a phone was given and SMS is on), and reviewers are notified in the app: super admins always, plus the school admins of the chosen school.
   - Anti-abuse: hidden honeypot field (same reply, nothing stored), 5 applications per IP per hour (429), 3 per email per day (same reply, nothing sent).
3. **Review**: Admin → Users and permissions → **Teacher applications** (badge = pending count). School admins see their own school's applications; super admins see all, including schools typed as free text.
   - The reviewer confirms or edits the subjects and forms. Super admins pick any active school, use a suggested name match, or **Create this school** (the normal audited `POST /api/admin/schools`). School admins can only approve into their own school.
   - **Approve** creates a `teacher` in that school (phone stored unverified, unusable random password, `mustChangePassword`), one teacher assignment per subject and form of that subject's level, and emails a branded welcome with the sign-in email and a **Set your password** link (`/set-password?token=…`). If a phone was given and SMS is on, an SMS says the account is approved and to check email; the SMS never carries the link, because the number is not verified.
   - **Reject** needs a reason; a polite email gives it.
   - **Resend invite** (approved, password not set yet) issues a new link and voids the old one. Also on the user page (`POST /api/admin/users/:id/resend-invite`).
4. **Set password** (`/set-password`): the token is taken from the link and removed from the address bar; the page shows the sign-in email, checks the password policy and a confirmation, then signs the teacher in and shows a welcome on the teaching dashboard. An expired or used link explains this and offers **Request a new link**, which notifies the admins (once per link, generic reply).

## Tokens
Invites reuse the password-reset grants (`PasswordReset`, kind `invite`): 32 random bytes, only the SHA-256 stored, single use (claimed atomically), 72 hours, a new invite voids earlier unused ones. If the email cannot be sent the grant is voided at once.

## Admin-created users
With email configured, `POST /api/admin/users` emails the same set-password link (`delivery: 'email'`) instead of returning a temporary password. Without email, or if sending fails, the temporary password is shown once as before (`delivery: 'shown_once'`).
Student self-registration is unchanged and always creates students.

## Audit
`teacher_application.submit`, `.blocked` (honeypot / email limit), `.existing_account`, `.duplicate`, `.approve`, `.reject`, `.resend`; `user.create` (via teacher_application), `user.invite.resend`; `auth.password.set`; `auth.invite.renew_request`; `school.create`.

## Tests
- `server/test/teacherApplications.test.ts`: validation, honeypot, rate limits, enumeration safety, review scoping and no escalation, approve, reject, resend, single use and expiry, request-new, admin-created invites and the fallback; email (JSON transport) and SMS (fake adapter) are mocked.
- `web/src/pages/TeacherApply.test.tsx`: the form, free-text school, the set-password page and the expired-link path.
- `web/e2e/teacher-apply.spec.ts`: apply → school admin approves → set password → teaching dashboard, with axe; email mocked through the E2E server's test port (`PUT/GET/DELETE http://127.0.0.1:8788/mail`).
