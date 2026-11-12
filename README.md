# Mirasedu — مِراس

Miras (مِراس) is an Arabic-first, role-based education platform for university courses. Teachers manage courses, rosters, join codes, projects, exams and grading; students activate their courses with a join code, sign in with a password or a passkey (WebAuthn / Face ID), submit work and sit timed exams with integrity controls (Safe Exam Browser support, exam lock, on-device face presence check). A sandboxed demo mode lets visitors try both roles without touching real data.

- **Live site:** <https://mirasedu.web.app> (Firebase Hosting; `/api/**` and `/seb/**` are rewritten to the Cloud Run service `miras-api`)
- **Health check:** <https://mirasedu.web.app/api/health>

[![PR Verification](https://github.com/ProfAlfailakawi/Mirasedu/actions/workflows/ci.yml/badge.svg)](.github/workflows/ci.yml)
[![Deploy to Firebase Hosting](https://github.com/ProfAlfailakawi/Mirasedu/actions/workflows/firebase-hosting-deploy.yml/badge.svg)](.github/workflows/firebase-hosting-deploy.yml)
[![Deploy miras-api to Cloud Run](https://github.com/ProfAlfailakawi/Mirasedu/actions/workflows/deploy-cloud-run.yml/badge.svg)](.github/workflows/deploy-cloud-run.yml)

## Feature map / خريطة الميزات

The app is a single-page app: almost every screen lives in the root [App.tsx](App.tsx) and is reached from the teacher or student tab bar, so most features have no URL of their own. "Live link" lists a URL only where one really exists. API endpoints are in [server.ts](server.ts); search the file for the route string.

Status: **Working (يعمل)** = wired end to end and covered by code paths in production. **Experimental (تجريبي)** / **Disabled (معطّل)** = present in code but stubbed, switched off, or not released.

| Feature (الميزة) | What it does (ما تفعله) | Live link (الرابط المباشر) | Code (الشيفرة) | Status (الحالة) |
|---|---|---|---|---|
| Student registration and course activation | A student in a teacher's roster activates the platform and each course with a join code; un-activated courses show locked with their owner's name. Endpoints `/api/auth/register`, `/api/auth/verify-otp`, `/api/students/:id/activate-course`. | [Login screen](https://mirasedu.web.app) | [server.ts](server.ts), [src/server/generalJoinCodes.ts](src/server/generalJoinCodes.ts), [src/shared/course-activation-count.ts](src/shared/course-activation-count.ts) | Working |
| Password login | Student and teacher login with per-IP rate limiting and an identify step (`/api/auth/login`, `/api/auth/identify/:id`). | [Login screen](https://mirasedu.web.app) | [server.ts](server.ts), [App.tsx](App.tsx) | Working |
| Passkeys (WebAuthn / Face ID) | Register, list and remove passkeys, passkey login, recovery reset (`/api/auth/passkey/*`). Devices that have a passkey get a compact login card. | [Login screen](https://mirasedu.web.app) | [server.ts](server.ts), [App.tsx](App.tsx) | Working |
| Public / shared device login | Sign-in on a lab or shared device with an approval step from the student's own device (`/api/auth/public-device/*`). | — | [server.ts](server.ts) | Working |
| Device lock and device transfer | Accounts are bound to a device; moving to a new device needs teacher approval or a transfer, and the retired device is rejected (`/api/teacher/device-approval`, `/api/students/:id/reset-devices`). | — | [src/shared/device-audit.ts](src/shared/device-audit.ts), [src/shared/device-transfer-copy.ts](src/shared/device-transfer-copy.ts), [src/shared/device-review-notifications.ts](src/shared/device-review-notifications.ts) | Working |
| Password reset requests | "Forgot password" requests are routed to the right teacher, shown on the teacher home, and expire (`/api/auth/forgot-password`, `/api/teacher/password-reset-requests`). | — | [src/shared/password-reset-routing.ts](src/shared/password-reset-routing.ts), [src/shared/home-password-reset-requests.ts](src/shared/home-password-reset-requests.ts), [src/shared/password-reset-retention.ts](src/shared/password-reset-retention.ts) | Working |
| Join codes (teacher "Codes" tab) | Generate, issue manually, archive, scan/look up a typed code, code health and integrity, activation attempts, device list (`/api/teacher/join-codes`, `/api/teacher/code-scan`, `/api/teacher/code-integrity`, `/api/teacher/activation-attempts`). | — | [App.tsx](App.tsx), [src/server/generalJoinCodes.ts](src/server/generalJoinCodes.ts), [src/shared/join-code-issue-scope.ts](src/shared/join-code-issue-scope.ts) | Working |
| Courses, sections and rosters | Teacher courses/sections, allowed-student rosters, student lists with Arabic phonetic search and name ordering (`/api/teacher/sections`, `/api/teacher/allowed-students`, `/api/teacher/students`). | — | [App.tsx](App.tsx), [src/shared/phonetic-search.ts](src/shared/phonetic-search.ts), [src/shared/student-name-order.ts](src/shared/student-name-order.ts) | Working |
| Projects and student submissions | Students submit projects/exercises with file attachments (resumable upload session, drag-and-drop, PDF/PowerPoint preview via PDF.js); extensions and late attempts after a project closes (`/api/projects/submit`, `/api/submissions/upload*`, `/api/submission-attachments*`). | — | [server.ts](server.ts), [src/shared/project-submission-scope.ts](src/shared/project-submission-scope.ts), [src/shared/late-attempts.ts](src/shared/late-attempts.ts), [src/shared/file-drop.ts](src/shared/file-drop.ts), [public/pdfjs](public/pdfjs) | Working |
| Grading (including bulk grading) | Teacher grades submissions one by one or in bulk; over-max grades are rejected; grades round-trip; "not submitted" list opens only after the deadline (`/api/projects/:id/grade`, `/api/teacher/submissions`). | — | [src/shared/submission-grading-selection.ts](src/shared/submission-grading-selection.ts), [src/shared/not-submitted-gate.ts](src/shared/not-submitted-gate.ts), [src/shared/waiting-on-teacher.ts](src/shared/waiting-on-teacher.ts), [src/design/miras-exam-grade.css](src/design/miras-exam-grade.css) | Working |
| Exams and quizzes | Teacher creates exams, sends reminders and releases grades; students take timed quizzes with draft autosave and submit (`/api/teacher/exams`, `/api/teacher/exams/:id/release-grades`, `/api/quizzes/*`). | — | [server.ts](server.ts), [App.tsx](App.tsx), [src/design/miras-exam-timer.css](src/design/miras-exam-timer.css) | Working |
| Exam integrity | Single-session exam lock with heartbeat, integrity pulses and violation log, on-device face presence check (TensorFlow.js BlazeFace, self-hosted model), on-screen watermark (`/api/exam-lock/*`, `/api/exam-integrity/pulse`, `/api/students/:id/log-violation`). | — | [App.tsx](App.tsx), [public/vendor/blazeface-model](public/vendor/blazeface-model), [src/design/miras-exam-watermark.css](src/design/miras-exam-watermark.css) | Working |
| Safe Exam Browser (SEB) | Launches an exam inside SEB with a one-time pass and validates/closes the SEB session (`/api/seb/*`, `/seb/*`). | [miras-official.seb](https://mirasedu.web.app/seb/miras-official.seb) | [server.ts](server.ts), [seb/miras-official.seb](seb/miras-official.seb), [public/seb/miras-official.seb](public/seb/miras-official.seb) | Working |
| Practice exercises | Student "Practice" tab with exercises and quizzes (`/api/exercises`, `/api/exercises/submit`, `/api/teacher/exercises`). | — | [App.tsx](App.tsx), [server.ts](server.ts) | Working |
| Textbook and question bank | Teacher uploads a textbook (PDF), splits it into chapters, and manages an approved question bank (`/api/teacher/textbook/*`, `/api/teacher/question-bank`). | — | [server.ts](server.ts), [App.tsx](App.tsx) | Working |
| AI generation of questions / exercises | The Gemini call is switched off in code (`if (false && aiInstance)`), so `/api/teacher/textbook/generate-questions` and `/generate-exercises` always answer 503 "not available". | — | [server.ts](server.ts) | Disabled (معطّل) |
| Learning fingerprint and personal project | Student completes a learning-style fingerprint and gets a personal project brief. The brief comes from fixed templates; the Gemini branch is switched off (`/api/learning-fingerprint`, `/api/projects/generate`). | — | [server.ts](server.ts) | Experimental (تجريبي) |
| Learning intelligence | Rule-based drafts only (no AI model): student tutor hints, rubric feedback, teacher course summary, course understanding, viva questions. Outputs never contain a grade or misconduct verdict (`/api/learning-intelligence/*`). | [policy](https://mirasedu.web.app/api/learning-intelligence/policy) | [src/features/learning-intelligence/core.ts](src/features/learning-intelligence/core.ts), [src/features/learning-intelligence/LearningIntelligencePanel.tsx](src/features/learning-intelligence/LearningIntelligencePanel.tsx) | Working |
| Notifications | In-app inbox, course notifications, Web Push via Firebase Cloud Messaging, seen/unseen tracking (`/api/notifications/*`). | — | [server.ts](server.ts), [sw.js](sw.js), [src/shared/teacher-notification-scope.ts](src/shared/teacher-notification-scope.ts), [src/shared/notification-identity.ts](src/shared/notification-identity.ts), [src/shared/security-notification-groups.ts](src/shared/security-notification-groups.ts) | Working |
| Submissions dock dot | A dot on the teacher's Submissions icon for new hand-ins across all the teacher's courses, time-expired exam attempts, late attempts and students who joined after a project closed. | — | [App.tsx](App.tsx), [src/shared/late-attempts.ts](src/shared/late-attempts.ts) | Working |
| Teacher analytics and data tools | Accounts, audit log, integrity, reports, Miras export/import, data heal, workspace audit (`/api/teacher/reports`, `/api/teacher/logs`, `/api/teacher/miras-export`, `/api/teacher/miras-import`, `/api/teacher/data-heal`, `/api/teacher/audit-workspace`). | — | [App.tsx](App.tsx), [server.ts](server.ts) | Working |
| Admin: teacher accounts | Super-admin lists teachers and sets their passwords (`/api/admin/teachers`). | — | [server.ts](server.ts) | Working |
| Export to PDF | Server-side conversion of report data to PDF (`/api/convert-data-to-pdf`). | — | [server.ts](server.ts) | Working |
| Roll-call QR | Server endpoints exist (`/api/teacher/rollcall-qr`, `/api/students/rollcall-qr/activate`) but no screen in App.tsx calls them. | — | [server.ts](server.ts) | Experimental (تجريبي) — API only |
| Demo environment | Visitors enter a sandboxed demo as teacher or student; every `/api/` call from a demo tab carries its sandbox id so it can never reach real data (`/api/demo/*`). The build fails if the demo entry is missing from either login branch. | [Login screen → demo](https://mirasedu.web.app) | [src/server/demoSeed.ts](src/server/demoSeed.ts), [src/shared/demo-transport.ts](src/shared/demo-transport.ts), [scripts/verify-demo-entry.mjs](scripts/verify-demo-entry.mjs) | Working |
| PWA and in-app updates | Installable PWA (manifest, icons, iOS launch images), service worker, update prompt that waits until the page is idle. The build fails if the PWA assets are incomplete. | [manifest](https://mirasedu.web.app/manifest.webmanifest) | [sw.js](sw.js), [manifest.webmanifest](manifest.webmanifest), [src/shared/app-update.ts](src/shared/app-update.ts), [scripts/verify-pwa.mjs](scripts/verify-pwa.mjs) | Working |
| "We're updating" page | Branded page shown instead of a Google error while `miras-api` is being deployed or cold-starting; polls `/api/health`. | [updating.html](https://mirasedu.web.app/updating.html) | [public/updating.html](public/updating.html), [src/shared/updating-notice.ts](src/shared/updating-notice.ts) | Working |
| Error monitoring | Browser errors are reported to `/api/monitor/report` and reviewed in the teacher's monitoring view; self-hosted ORBIT sensor sends anonymous error notes. | — | [server.ts](server.ts), [public/orbit-sensor.js](public/orbit-sensor.js) | Working |
| Privacy policy | Stand-alone page, intentionally not linked from the app. | [privacy-policy.html](https://mirasedu.web.app/privacy-policy.html) | [public/privacy-policy.html](public/privacy-policy.html) | Working |
| Responsive layout | Width-based responsive layer, including the folded posture of dual-screen phones, narrow phones and wide desktops. | — | [src/design/miras-duo-layouts.css](src/design/miras-duo-layouts.css), [docs/DESIGN.md](docs/DESIGN.md) | Working |
| Native Apple app (iOS / iPadOS / Mac) | Capacitor shell that loads the live site, with offline banner, store metadata and a release script. Not on the App Store yet: signing, App Store Connect and TestFlight are still open in the release checklist. | — | [apple/](apple), [apple-release/checklists/release.md](apple-release/checklists/release.md) | Experimental (قيد التطوير) |
| Online payment | `/api/payment/simulate` returns 503 `PAYMENT_DISABLED`; no payment gateway is connected. | — | [server.ts](server.ts) | Disabled (معطّل) |

## Architecture

- **Frontend:** React 19 + Vite 6 + Tailwind 4 + TypeScript. The entry point is [src/main.tsx](src/main.tsx), which imports the **root** [App.tsx](App.tsx) (a large single component that is edited from Google AI Studio). Logic is being extracted into [src/shared/](src/shared), [src/features/](src/features) and [src/components/](src/components); styles live in [src/design/](src/design) and the root [index.css](index.css).
- **Backend:** one Express server, [server.ts](server.ts), bundled with esbuild to `dist/server.cjs`. Main endpoint groups: `/api/auth/*` (login, passkeys, public devices), `/api/teacher/*` (all teacher tools, guarded by a teacher session), `/api/students/*`, `/api/projects/*`, `/api/submissions/*`, `/api/quizzes/*`, `/api/exam-lock/*`, `/api/seb/*`, `/api/notifications/*`, `/api/learning-intelligence/*`, `/api/demo/*`, `/api/monitor/*`, `/api/health`, `/api/version`.
- **Data:** the server keeps the whole database in process memory ([src/server/db.ts](src/server/db.ts)) and persists it to Firestore through the Admin SDK, split into chunks ([src/server/entity-chunk-count.ts](src/server/entity-chunk-count.ts), [src/shared/atomic-cloud-write.ts](src/shared/atomic-cloud-write.ts)). Writes are confirmed before the response is sent. [firestore.rules](firestore.rules) deny all direct browser access; the server is the only authority.
- **Hosting:** [firebase.json](firebase.json) serves `dist/` on Firebase Hosting (site `mirasedu`) and rewrites `/api/**` and `/seb/**` to Cloud Run `miras-api` (us-central1). The container is built from the [Dockerfile](Dockerfile).
- **Apple shell:** [apple/](apple) is a separate Capacitor project; nothing in it is bundled into the web build.

## Run locally

**Prerequisites:** Node.js 22 (CI and deploy use 22; `firebase-admin` 14 needs it) and npm.

1. `npm ci`
2. Copy [.env.example](.env.example) to `.env` and fill in what you need. `MIRAS_SESSION_SECRET` is required in production; in development a random per-process secret is used if it is missing. Without `firebase-applet-config.json` the server can run local-only on `data/db.json` when `MIRAS_ALLOW_LOCAL_ONLY_MODE=true` (this is what the flow tests do).
3. `npm run dev`, then open <http://localhost:3000>.

| Script | Command | What it does |
|---|---|---|
| `dev` | `tsx server.ts` | Express server with Vite middleware on port 3000 |
| `build` | `verify:pwa` + `verify:demo-entry` + `vite build` + esbuild of `server.ts` | Production build into `dist/` |
| `start` | `node dist/server.cjs` | Run the production build |
| `clean` | `rm -rf dist server.js` | Remove build output |
| `lint` | `tsc --noEmit` | Type check (the only lint step) |
| `test:flows` | `bash tests/run-flows.sh` | Full regression suite (below) |
| `verify:pwa` | `node scripts/verify-pwa.mjs` | Fails if PWA icons/screenshots/manifest are incomplete |
| `verify:demo-entry` | `node scripts/verify-demo-entry.mjs` | Fails if the demo entry is missing from a login branch |

## Tests and quality gates

- [tests/run-flows.sh](tests/run-flows.sh) is the main oracle. It starts the real server **local-only** (moves `firebase-applet-config.json` aside, backs up and restores `data/db.json`, refuses to start if the port is already in use), seeds data, and runs black-box HTTP flow groups (`tests/flows.*.mjs`) plus unit tests (`tests/*.test.ts`, `tests/*.test.mjs`) through `tsx --test`. Set `MIRAS_TEST_PORT` to use a port other than 3000. Details: [tests/README.md](tests/README.md).
- Examples: [tests/flows.main.mjs](tests/flows.main.mjs) (registration and activation), [tests/flows.security.mjs](tests/flows.security.mjs), [tests/flows.passkey-enroll.mjs](tests/flows.passkey-enroll.mjs), [tests/flows.grading.mjs](tests/flows.grading.mjs), [tests/flows.exam-create.mjs](tests/flows.exam-create.mjs), [tests/flows.demo-hosting.mjs](tests/flows.demo-hosting.mjs).
- [.github/workflows/ci.yml](.github/workflows/ci.yml) ("PR Verification") runs on every pull request to `main`: `npm ci` → `npm run lint` → `npm run test:flows` → `npm run build`.
- Open security items and their status: [SECURITY-TODO.md](SECURITY-TODO.md). Visual QA notes: [docs/QUALITY-SCORECARD.md](docs/QUALITY-SCORECARD.md), [docs/VISUAL-POLISH-AUDIT.md](docs/VISUAL-POLISH-AUDIT.md).

## Deployment

Both deploy workflows are **manual only** (`workflow_dispatch`); merging to `main` does not deploy anything. Run them from the GitHub Actions tab. Each one repeats the type check and flow tests before deploying.

| What | Workflow | Trigger | Does |
|---|---|---|---|
| Web front end | [.github/workflows/firebase-hosting-deploy.yml](.github/workflows/firebase-hosting-deploy.yml) | Manual | lint → test:flows → build → `firebase deploy --only hosting:mirasedu` (project `meras-320eb`) |
| API (`miras-api`) | [.github/workflows/deploy-cloud-run.yml](.github/workflows/deploy-cloud-run.yml) | Manual | lint → test:flows → `gcloud run deploy miras-api --source .` with keyless Workload Identity, then checks the service settings |

The hosting workflow deploys the front end only. A change in `server.ts` reaches the live site only after the Cloud Run workflow runs. One-time setup of the deploy identity: [docs/deploy-miras-api.md](docs/deploy-miras-api.md).

### Cloud Run settings that must not change

1. **`--max-instances=1` is mandatory.** The server holds the database in process memory, so a second instance means split state and lost writes. The deploy workflow passes it and fails if the service ends up with any other value.
2. **Zero idle cost:** `--min-instances=0` with request-based CPU billing and `--cpu-boost`. After idling, the first request waits a few seconds while the database is re-read from Firestore; the port opens only after that sync, so the dashboard is never shown empty. There is deliberately no keep-warm job.
3. **`MIRAS_SESSION_SECRET` is mandatory.** The container refuses to boot without it. Set it as a Secret Manager secret on the service, never as a committed value:

   ```sh
   gcloud run services update miras-api --region us-central1 \
     --set-secrets MIRAS_SESSION_SECRET=miras-session-secret:latest
   ```

   The deploy workflow does not pass `--set-secrets` or `--set-env-vars` (that would replace what is already set); it only checks that the secret is present afterwards.

Optional: `MIRAS_ALLOWED_ORIGINS` (comma separated) widens the CORS allowlist beyond the project's own Hosting domains.

## Security

- **Firestore rules** deny all direct client access; every read and write goes through the server with the Admin SDK.
- **Sessions:** HMAC-signed `miras_session` cookie; teacher routes (`/api/teacher/*`) and grading require a teacher session, and student-owned routes check that the session matches the student.
- **WebAuthn passkeys** and device binding reduce credential sharing on shared devices.
- **Sanitization:** user-submitted HTML is sanitized with DOMPurify before rendering.
- **Rate limits and locks:** login is rate limited per IP; exam submission uses server-side locks to prevent duplicate submissions.
- **Headers:** Hosting sends `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'` on every page.

---

آخر تحديث للتوثيق: 2026-11-12 (Documentation last updated: 2026-11-12)
