# Custom domain: ghlearn.com

Firebase Hosting serves the web app; Render serves the API. The default hosts (`ghlearn-f31c9.web.app` and `ghlearn-api.onrender.com`) stay live.

## 1. DNS records to enter in Namecheap → Advanced DNS

Remove the parking records Namecheap added, then add these. TTL **Automatic** (or 5 min) is fine.

| Type | Host | Value | Purpose |
|---|---|---|---|
| **A Record** | `@` | `199.36.158.100` | Apex → Firebase Hosting |
| **TXT Record** | `@` | `hosting-site=ghlearn-f31c9` | Firebase ownership |
| **TXT Record** | `_acme-challenge` | `m240gQxIe3PLl8t86_yGC7-ZKveKhF_2cvI1VsiX8pc` | Firebase TLS for the apex |
| **CNAME Record** | `www` | `ghlearn-f31c9.web.app.` | www → Firebase (redirects to apex) |
| **TXT Record** | `_acme-challenge.www` | `IsEhEM-7jn312n9UykKtSTc659j_OMUnZbpOPmpKA08` | Firebase TLS for www |
| **CNAME Record** | `api` | `ghlearn-api.onrender.com.` | API → Render |

**Remove** (parking / mail you don't need):
- A `@` → `192.64.119.104`
- CNAME `www` → `parkingpage.namecheap.com`

You can keep the SPF TXT (`v=spf1 include:spf.efwd.registrar-servers.com ~all`) if you use Namecheap email forwarding.

Nameservers should stay `dns1.registrar-servers.com` / `dns2.registrar-servers.com` (Namecheap BasicDNS).

## 2. Status: LIVE (15 Oct 2026, 16:10 UTC)
- **https://ghlearn.com**: the canonical app (Firebase, valid managed cert). **https://www.ghlearn.com** sends a 301 to the apex and keeps the path.
- **https://api.ghlearn.com**: the API (Render, verified, valid cert). `ghlearn-api.onrender.com` still answers too.
- **ghlearn-f31c9.web.app / .firebaseapp.com**: they redirect to `https://ghlearn.com` with the same path, query and hash. Firebase cannot redirect only its default domain (`firebase.json` redirects apply to every domain), so `web/public/host-redirect.js` does it by hostname. It is loaded first in `index.html` and allowed by the CSP (`script-src 'self'`).
- **Cookies:** first-party. `COOKIE_SAMESITE=lax`, `COOKIE_DOMAIN=.ghlearn.com`, `COOKIE_SECURE=true` (`gl_at`, `gl_csrf` on `/`, `gl_rt` on `/api/auth`).
- **CSP:** `connect-src` allows `https://api.ghlearn.com` and the onrender host.
- **App URL:** `APP_URL=https://ghlearn.com` builds the links in notification emails (`server/src/services/notify.ts`). It falls back to the first https CORS origin.
- **CORS_ORIGINS:** `https://ghlearn.com,https://www.ghlearn.com,https://ghlearn-f31c9.web.app,https://ghlearn-f31c9.firebaseapp.com`.
- **Web build:** picks the API by hostname (`web/src/lib/apiBase.ts`), so the build command is unchanged (`VITE_API_URL=https://ghlearn-api.onrender.com`).
- **Verified live in a browser:** super admin login and `/admin` (Overview), student login and `/learn`, both sessions surviving a reload with the access cookie deleted (silent refresh), all API traffic on `api.ghlearn.com`, and the web.app and www redirects.

## 3. How it was flipped (kept for reference / re-runs)
`SET_COOKIE_DOMAIN=1 RENDER_API_KEY=… scripts/flip-custom-domain-cookies.sh` changes `COOKIE_SAMESITE`, `COOKIE_DOMAIN` and `APP_URL` **one key at a time** (`PUT /env-vars/{KEY}`) and then deploys Render.

> **Never** `PUT /v1/services/<id>/env-vars` with an array: it **replaces all** env vars. That happened once (15 Oct 2026, fixed from the creation-time values before any deploy went live). The service now has 17 keys.

## 4. Rollback
1. Remove `<script src="/host-redirect.js">` from `web/index.html`, rebuild and deploy hosting. web.app then serves the app again.
2. Set `COOKIE_SAMESITE=none` and delete `COOKIE_DOMAIN` (single-key calls), then redeploy Render. Cross-site web.app → onrender sessions work again.
