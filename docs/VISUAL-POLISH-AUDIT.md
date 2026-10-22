# VISUAL-POLISH-AUDIT

Visual-layer only. No logic, routes, handlers, ids, aria names or data changed.
Rules followed: `docs/DESIGN.md` (single indigo brand colour, colour only for status, lucide at 1.75, labelled primary buttons, 44px touch, reduced-motion via `MotionConfig`). The repo has no `guard-*` scripts; the only guards are `verify:pwa` and `verify:demo-entry`, both run in `npm run build` and both pass.

Method: source read of every UI file, plus Playwright screenshots (Chromium, 390px and 1280px) of the production build served locally in demo mode (`/api/demo/enter`, teacher and student sessions). The demo-entry button is hidden in the UI (`MIRAS_DEMO_ENTRY_VISIBLE = false`), so the demo session was seeded through the same API calls `enterDemo` makes.

## Verdict
The site already has a calm layer (`miras-calm.css`, `dna.css`, about 36 design CSS files). Almost every screen already uses stat tiles, icon tabs, ring/progress meters and step rails. Findings were few and small; large rewrites were deliberately not done.

## Inventory

### UI files (all examined)
| File | What | Finding | Action |
|---|---|---|---|
| `App.tsx` (50k lines) | all screens (below) | see per-screen table | 4 targeted edits |
| `index.css` (19k lines), `src/index.css` | base + legacy styles | layered with `!important`; DESIGN.md says do not merge | untouched |
| `miras-overrides.css`, `public/pdfjs/web/miras-overrides.css` | small overrides / PDF viewer skin | fine | untouched |
| `src/design/*.css` (36) | design layers | `miras-calm.css` is the canonical calm layer | +1 media rule in `miras-calm.css` |
| `src/design/DnaKit.tsx`, `motion.tsx`, `JourneyRail.tsx` | shared kit, motion, journey rail | already honours reduced motion | untouched |
| `src/components/MirasLoader.tsx`, `LoginRevealOverlay.tsx`, `SmartIconGuidance.tsx` | loader, login reveal, guided-icon hints | icon-led already | untouched |
| `src/features/learning-intelligence/LearningIntelligencePanel.tsx` | learning-intelligence panel | has its own flow test `flows.learning-intelligence.mjs` | untouched (not rendered in demo; not verified visually) |
| `src/main.tsx`, `index.html` | entry, shell, meta | no visual content | untouched |
| `public/pdfjs/web/viewer.html`, `viewer.css` | vendored pdf.js | third-party | untouched |

### Screens (rendered unless noted)
| Screen | Finding | Action |
|---|---|---|
| Login (identify by university number, 390/1280) | already minimal: one field, one primary button | left alone |
| Login: passkey compact card, sign-up, password reset, public-device flow | not rendered (needs real accounts/devices); read in source only | left alone |
| Login reveal overlay / tour | already icon + short line | left alone |
| Teacher Home (stat tiles, password-reset requests, exam pulse) | stat tiles already real-data only; reset-request banner dense but functional | left alone |
| Teacher Courses | three equal-weight action buttons in three colours (white, indigo tint, red tint) at `App.tsx` ~43755 | **changed**: edit now neutral like lock, delete is a quiet ghost (red text only, tint on hover). Labels, handlers, aria unchanged |
| Teacher Students | explanatory paragraph under "رفع سريع من Excel" (`App.tsx` ~30878) | **changed**: file icon + two column chips (name, university number, icons `User`, `Hash`) + one short line; the original sentence stays as `sr-only` text for screen readers |
| Teacher Questions (bank, categories, search) | dense but already tabbed with icons | left alone |
| Teacher Submissions | eyebrow "وضع التصحيح السريع" + heading "التسليمات" repeats the header title directly above (`App.tsx` ~39952) | **changed**: visually hidden on phone only (`sr-only sm:not-sr-only`), still in DOM |
| Teacher Codes (health, generate, archive, attempts, manual, devices) | archive hero repeats the section name already shown in the header (`App.tsx` ~47171) | **changed**: duplicate heading hidden on phone only via new `.miras-section-title-dup-sm` (same pattern as existing `.miras-section-title-dup`); desktop keeps it to anchor the tab bar |
| Teacher Analytics / follow-up (integrity etc.) | already uses `miras-section-title-dup` | left alone |
| Teacher Textbook ("المصدر") | not reachable in demo; source only | left alone |
| Student Home (available-now tiles, progress ring, step rail) | already infographic | left alone |
| Student Exams / Projects lists | clean | left alone |
| Student alert modal (due soon) | short, icon-led | left alone |
| Exam-taking screens, grade release, device lock, notifications, dialogs | not exercised here (need live exam state); heavy dedicated CSS (`miras-exam-*.css`) | left alone |
| Empty / error / loading states | `MirasLoader` already unified | left alone |

## Not changed on purpose
- Exam-taking, payments-like flows, auth, device lock: no visual change without a live session to verify.
- Delete / edit button text and `aria-label`s: kept (DESIGN.md requires visible labels).
- No merging of CSS layers (DESIGN.md "future work").
- No new numbers or stats added anywhere.

## Verification
See the commit message / final report for the exact commands and results.

---

# Round 2 — elevation and motion

Presentation only. One new layer, `src/design/miras-polish.css`, imported last in `src/main.tsx` (after `miras-identity.css`). It builds on `calm`, `identity`, `dna-motion` and the existing per-screen rise animations; it does not merge or edit any of them (DESIGN.md: do not merge layers). No `App.tsx`, logic, markup, route, test or dependency was changed.

Method: production build served locally in demo mode on a spare port with Firestore config moved aside (restored byte-for-byte, `git status` clean apart from the two intended files). Playwright (Chromium) screenshots at 390px and 1280px before and after, teacher (courses, students, questions, submissions, codes, home) and student (home, exams, projects), plus a dark-theme pass on the two screens changed. Findings of the pass: the product was already at a high level (stat tiles, rings, step rails, icon tabs, Naskh numerals, graph-paper identity), so Round 2 is deliberately restrained.

## What changed, per screen
| Screen | Change |
|---|---|
| Teacher Students (1280) | The "Excel upload" and "add student manually" strips were two full-width bars, each mostly empty space between label and button. On >=1024px they now sit side by side in a two-column grid (the roster header below stays full width). Phone layout unchanged. |
| Teacher Questions bank | Row actions follow the Round 1 course-card language: edit is neutral outline, delete is a quiet ghost with red text and a tint on hover. Visible labels, handlers and aria names untouched. |
| Student Home (>=768px) | The two main panels ("available now", "study path") get roomier padding and a little space under their headings (they were flush to the panel edge). |
| Teacher Students, Questions, Codes, Courses | First-appearance rise and a 1px hover lift (see motion). |
| Teacher nav | The active tab icon settles once when it becomes active. |

## Motion inventory (one token set: `--mo-ease` cubic-bezier(.2,.7,.2,1); `--mo-fast` 120ms, `--mo-base` 180ms, `--mo-slow` 260ms, rise 8px, stagger step 40ms)
| What | Trigger | Duration | Notes |
|---|---|---|---|
| Student roster cards and question-bank rows fade+rise (`mo-rise`) | element mount | 260ms, delay 0..280ms for the first 8; rest appear instantly | once per element; fill-mode `backwards`, so the end state is the static style (no leftover transform) |
| Active dock icon settle (`mo-settle`) | `is-active` class applied | 180ms | once per activation |
| Button press `scale: .98` | `:active` | 120ms in, instant out | not inside `.meras-exam-shell`, not on disabled buttons |
| Card hover lift `translate: 0 -1px` + soft shadow | hover (pointer devices only) | 180ms | roster cards, question rows, code cards, course cards |
All of it is inside `@media (prefers-reduced-motion: no-preference)`; a matching `reduce` block sets `animation/transition: none` and clears `scale/translate`. Only `transform`/`opacity` family properties (individual `scale`/`translate`) animate, plus the box-shadow change on hover. No infinite loops were added.

Verified in the browser (Web Animations API): the keyframes run with 1 iteration, durations 180/260ms with 40ms steps, final computed style is `opacity 1 / transform none`; card rectangles are identical before and after the animation (no layout shift); with `reducedMotion: 'reduce'` no animation exists and `:active` leaves scale unset; horizontal overflow is 0 at 390 and 1280 on every screen visited.

## Left alone on purpose
- Exam-taking, answer inputs, grade release, device lock, notifications (including the student "important alert" popover and its entrance): calm static only, no new motion.
- Tab-content fade stays opacity-only (`miras-transitions.css`): adding a translate there would briefly displace fixed-position dialogs that live inside tab content.
- Focus-ring ease-in: outline is not a transform/opacity property, so it was not animated.
- Existing entrance animations (metric tiles, course cards, code stats, student lists, auth card) and the existing infinite loops (orb, connection pulse, hub breathe, loader): not touched.
- The student-side and teacher-side modals/drawers/toasts already have their own entrance (`mirasCmdk*`, `mirasToastQuietIn`, `mirasReady*`); not duplicated.
- No skeleton shimmer was added: the demo never shows a genuinely loading block other than `MirasLoader`.
- No new stats or numbers; no infographic with invented data.

## Could not verify
- Empty, error and loading states (demo data is always seeded), passkey login branches, teacher textbook, learning-intelligence panel, exam-taking and grade-release screens: not reachable or deliberately not exercised.
- Light theme only was checked on the screens that did not change; dark theme was checked on Students and Questions.
- The standard `npm run test:flows` refuses to run because another process holds port 3000 on this machine; the same script ran against the production build on a different port (see the final report for the result). `npm test` does not exist in this repo (CI runs lint, test:flows, build).
