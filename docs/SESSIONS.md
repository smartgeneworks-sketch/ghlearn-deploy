# Sessions and idle sign-out

## Limits
| Who | Default | Setting (System settings → Security and sign-in) |
|---|---|---|
| Students, parents, teachers, counselors | 30 min | `sessions.idleMinutesUser` (5-240) |
| Administrator roles: super, school and curriculum admins, editors, reviewers, operators | 15 min | `sessions.idleMinutesAdmin` (5-240) |

A user with any administrator role gets the administrator limit. Only super admins (`platform:manage`) can change the values. Changes are audited as `settings.update`, apply at once, and reach the app through `GET /api/settings/public` → `idle: { userSeconds, adminSeconds, warnSeconds }`.

## In the app (`web/src/lib/idle.ts`, `components/IdleTimer.tsx`)
- Activity: mouse movement and clicks, key presses, touch, scrolling, the wheel, and returning to the tab (the timeout is checked first, so a laptop opened after the limit is signed out).
- Work in progress counts as activity: a streaming tutor answer (`streamPost`) and an upload (`uploadWithProgress`).
- All tabs share one last-activity time (localStorage `gl:lastActive`), so activity in one tab keeps the others alive. A BroadcastChannel (`gl-idle`, with a storage-event fallback) signs every tab out when one signs out, for any reason.
- 60 s before the limit an `alertdialog` ("Are you still there?") shows a countdown with **Stay signed in** (focused; Escape does the same) and **Sign out**. Passive mouse movement does not dismiss it.
- On timeout: registered savers run (a timed practice or assessment attempt re-saves its answers, `registerBeforeIdleLogout`), then `POST /api/auth/logout {reason:'idle'}`, the query cache is cleared, and the app goes to `/login?reason=idle&next=<path>`. The login page says "You were signed out after a period of inactivity." and returns to `next` after signing in, if it is a same-site path (`safeNext`: starts with one `/`, no scheme, no backslash trick, not /login).
- While active, the app pings `POST /api/auth/activity` at most once a minute, so reading without API calls does not let the server session lapse.

## On the server (`server/src/services/idle.ts`)
- Each session (refresh-token family) records `lastActiveAt`. The app reports the user's idle time in `X-Idle-Ms` once it is 30 s or more; requests without it count as activity now (so most requests need no CORS preflight; the header is allowed and preflights are cached for 2 h).
- `authenticate` refuses a session whose last activity is older than the limit, or whose request reports an idle time beyond it: the family is revoked, `session.idle_timeout` is audited (`via: request`), and the reply is `401 SESSION_IDLE`, which makes the app sign out.
- The stored time is written at most once a minute per session (in-memory cache keyed by session).
- `/api/auth/refresh` checks the stored time before rotating; an idle session is revoked, its cookies cleared, audited (`via: refresh`) and refused with `401 SESSION_IDLE`. Rotation copies `lastActiveAt`, so refreshing is not activity.
- An idle sign-out by the app is audited too (`via: client`).

## Tests
- `server/test/idle.test.ts`: defaults, the 5-240 bounds and the audit, request expiry, the admin limit, refresh refused, rotation, the throttled write, the client audit.
- `web/src/components/IdleTimer.test.tsx` (fake timers): warning and countdown, Stay signed in, timeout with draft save and redirect, busy work, shared activity across tabs, server-side expiry, the broadcast, `safeNext`, the login message and `next`.
- `web/e2e/idle.spec.ts`: short limits set through the E2E server's local test port (`PUT http://127.0.0.1:8788/idle`, honoured only with `NODE_ENV=test`), axe on the warning, sign-out and return, two tabs.
