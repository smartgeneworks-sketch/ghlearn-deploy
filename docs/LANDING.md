# Public website and landing page

Brief: [LANDING_SPEC.md](LANDING_SPEC.md). Live at https://ghlearn.com.

## Name and branding
There is one source for the name and logo: **System Settings → Branding** (`PlatformSettings.branding`).
The configured name is **GH Learn**, so that is what the site shows; the "LearnSmart AI" fallback from the brief is not used.
Landing copy can contain `{appName}`, which is replaced at render time.

## Routes (web)
| Path | Who | What |
|---|---|---|
| `/` | visitors | Landing page (lazy chunk). Signed-in users get their dashboard here, as before. |
| `/welcome` | everyone | The landing page, also for signed-in users (Continue Learning goes to their role's home). |
| `/subjects`, `/subjects/:id` | everyone | Real catalogue, verified topics, public preview lessons |
| `/preview/:id` | everyone | A lesson explicitly marked as a public preview (no answers or teacher notes) |
| `/teachers`, `/schools` (enquiry form), `/help` (contact form), `/contact`, `/accessibility` | everyone | Information pages |
| `/admin/website` | `platform:manage` | Admin → Public Website: landing content editor and enquiries |

Navigation is auth-aware. Visitors see **Log In** and **Start Learning Free**. Signed-in users see **Continue Learning**, which goes to `/learn`, `/teach` or `/admin` depending on role, plus an Admin panel or Teacher workspace link when that role also applies. When signed in, the logo goes to the dashboard.

## API
Public (no sign-in; CSRF still applies to POST):
- `GET /api/auth/session`: `{ user | null, refresh }`. Always 200, so visitors' consoles show no 401s.
- `GET /api/public/landing`: content, branding, enabled levels, feature flags and legal flags.
- `GET /api/public/subjects?filter=&featured=1`: active subjects at enabled levels. `publishedLessons` counts only published resources open to all students (not school-restricted).
- `GET /api/public/subjects/:id`: the subject, its verified curriculum topics and its public preview lessons.
- `GET /api/public/search?q=` (2–80 chars, regex-escaped, debounced 300 ms in the UI): subjects, verified topics and public preview lessons only.
- `GET /api/public/lessons/:id`: only if the lesson is published, marked `publicPreview`, not school-restricted, and its resource is published to students. Returns sections A, B, D, E, F, G, J and K only (never the assessment I, answers C or teacher notes T). Anything else gets the same 404.
- `POST /api/public/enquiries`: school or contact. zod-validated, needs consent, has a honeypot, rate-limited to 5 per hour per IP. Stored in `Enquiry` and audited as `enquiry.create`. A notification email goes to the configured organisation email only when SMTP is configured; `emailStatus` records what happened.

Lesson-bearing responses use `Cache-Control: no-cache`, so removing a preview takes effect at once. Landing content and subjects are cached for 30–60 s.

Admin (`platform:manage`):
- `GET/PUT /api/admin/website/landing`, `POST /api/admin/website/landing/check`, `POST /api/admin/website/landing/reset`: a strict zod schema with internal-path or https-only links (no `//host`, `javascript:` or `http:`), secret scanning, versioning, and audit records `landing.update` (with diff) and `landing.reset`.
- `GET /api/admin/website/enquiries`, `PATCH /api/admin/website/enquiries/:id`: status and internal note, audited.
- `POST /api/lessons/:id/public-preview {enabled}` (`content:publish`): refused (409) unless the lesson is published and open to all students. It is audited, and unpublishing clears it.

## Content config
The landing content is one document in `PlatformSettings` (key `landing`). The schema and defaults live in `shared/src/landing.ts`; the defaults hold the brief's copy verbatim. Each section falls back to the defaults on its own. The organisation block is seeded with:
- SmartGene Solutions
- P. O. Box AH1237, Achimota, Accra, Ghana
- info@smartgenesolutions.com
- +233 53 050 6573 (`tel:+233530506573`)
- #smartgene

That block is used in the footer, on the Contact page and as the enquiry notification address.

## Live sessions section
`#live-sessions` (after "Your learning space") describes the existing Meetings feature:
- Students book a teacher's or counselor's published slot, or propose a time, with a topic and an in-person or online mode.
- Staff accept, decline or reschedule.
- Online sessions carry an external https meeting link; there is no built-in video calling.
- Both sides are notified.
- Booking is limited to the student's own school.

The text (heading, paragraph, 2–4 benefits, note, button labels) is the `liveSessions` section of the landing config, editable in Admin → Public Website. The section, its nav item and its footer link are hidden when Meetings is switched off (`features.meetings`).

Where the button goes:
- Students: `/meetings`.
- Teachers and counselors: "Manage your sessions" (`/meetings`).
- Visitors: registration (or sign-in when self-registration is off).
- Other signed-in roles: no button.

The booking card is static and labelled "Example". The FAQ has "Can I meet my teachers live?".

**Photo.** The original stock photo was cut out with rembg (`isnet-general-use`), keeping the student, his laptop and the desk. Edge colours were decontaminated with pymatting's foreground estimation, and a faint window-light rim on the hair was replaced with interior hair colour. The person was not altered.

The cut-out is composited onto an on-brand navy background with a soft teal glow, a dot pattern and a gold ring. The two floating chips are HTML, marked `aria-hidden`.

Files are in `web/public/img/student-live-{480,800,1200}.{avif,webp,jpg}`. The page serves them through `<picture>` with `srcset`/`sizes`, `loading="lazy"`, a fixed width and height (no layout shift) and descriptive alt text.

## Honesty rules in the UI
- There are no statistics, testimonials, endorsements or social links. The principles section says that no testimonials have been collected yet.
- The tutor exchange, the product preview, the lesson sample (shown when no public preview exists) and the quiz are labelled "Simulated example", "Illustration", "Sample" and "Demo question".
- The data-protection note is a commitment to Ghana's Data Protection Act, 2012 (Act 843), not a certification.

## Tests
- `server/test/landing.test.ts`: content, permissions, validation, audit, counts, filters, search, preview protection, enquiries.
- The `test/security.test.ts` route matrix lists the public routes.
- `web/src/landing/landing.test.tsx`: defaults, link safety, FAQ, quiz, debounced search, auth-aware nav.
- `web/e2e/landing.spec.ts`: dead-link crawl, CTAs and anchors, footer, search, filters, quiz and FAQ by keyboard, auth-aware nav per role, access protection, enquiries end to end with admin handling, admin editor (validation, live update, audit, restore), phone, tablet and desktop, axe, and no console errors or failed requests.
- `web/e2e/scenario.spec.ts` step 6b: marks a published lesson as a public preview, has a visitor find it in search and read it without answers, then removes it.

## Known limitations
- Live has no public preview lessons until a reviewer marks one, so the lesson section shows a labelled sample.
- JHS is disabled live, so the JHS filter explains that it is closed.
- Enquiry emails are only sent once SMTP is configured; until then they are stored and visible in the admin panel.
- Static `<head>` meta (Open Graph and Twitter cards with an original 1200×630 image) is fixed in `web/index.html` for crawlers. In-app titles and descriptions update from the config.
- Legal pages show the configured terms and privacy text, which are currently empty live.
