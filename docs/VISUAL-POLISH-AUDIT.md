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
