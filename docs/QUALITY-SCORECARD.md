# Quality scorecard, visual polish round 3

Presentation only. No logic, server, data, payment, auth or test changes. No new dependencies.

## Method

- Harness: Playwright + Chromium (headless, `--no-sandbox`) with axe-core and the custom hard criteria
  H1 axe, H2 horizontal overflow, H3 clipped text, H4 console errors, H5 CLS, H6 focus indicator,
  H7 stuck-invisible content, H8 animation under reduced motion, H9 text contrast.
- Screens (58 per light viewport, 29 per dark viewport): 4 login states, 17 teacher states
  (home, courses, students, questions x3, submissions x2, codes x5, add course/student/question,
  alerts) plus the teacher tour, 6 student states (home, alert, device lock, exams, projects,
  notifications) plus the student tour. Light runs are repeated with reduced motion; dark runs are not.
- Before = `origin/main` (0086a65), after = this branch, each built and served locally in local-only
  demo mode on separate ports.

## Totals (screens fully passing every hard criterion)

| Viewport / theme | Screens | Before | After | Contrast failures before / after | Screens with serious/critical-or-any axe violation before / after |
|---|---|---|---|---|---|
| 320 light | 58 | 0 | 2 | 15 / 8 | 56 / 0 |
| 320 dark | 29 | 0 | 1 | 4 / 2 | 26 / 0 |
| 390 light | 58 | 0 | 2 | 15 / 8 | 57 / 0 |
| 390 dark | 29 | 0 | 1 | 4 / 2 | 29 / 0 |
| 768 light | 58 | 0 | 2 | 16 / 8 | 58 / 0 |
| 1280 light | 58 | 0 | 2 | 12 / 0 | 58 / 0 |

"Axe violations" before were dominated by `meta-viewport` (zoom disabled), `landmark-one-main`,
`region`, `select-name` and `aria-required-children`. After the change, the only axe rule still
reported is moderate `heading-order` (and a few `region` notes on overlays).

Strict "perfect" stays low because of two items that are not fixed (below). Excluding H6 and the
moderate `heading-order` rule, passing screens rose from 0 to 34/58 (320 and 390 light, 768 light),
20/29 (dark) and 42/58 (1280 light). The remaining failures there are console 401/403/404
responses that the demo environment produces on purpose (login lookups of unknown ids, device
lock) and the progress-label contrast noted below.

Note on timing: the "after" numbers come from a build taken before the last CSS commit (progress
label `!important` fix). That one rule was verified by injecting the CSS in the live page (computed
colour changed to `rgb(71,85,105)`, about 7.5:1); the 8 remaining light contrast failures at 320/390/768
are that same label ("المكتمل") on the student screens, which the final commit addresses. A full
re-audit of the final commit was not repeated.

## Changed

- `index.html`: viewport meta no longer disables zoom (`maximum-scale=1`, `user-scalable=no` removed);
  skip link now targets `#root` so it actually moves focus.
- `App.tsx` (attributes only): `role="main"` on the device-lock and signup screens; `aria-label` on seven
  unlabeled `<select>` elements; `role="tab"` + `aria-selected` on the three question-bank mode buttons
  that already sat inside a `role="tablist"`.
- `src/design/miras-polish.css`: small slate-400 / amber-600 text darkened to pass 4.5:1 in light mode
  (dark mode untouched); white-on-amber-500 count badges use amber-700; student progress label
  darkened; 44px minimum touch targets on phones for the teacher toolbar buttons, name pills and
  roster-card buttons. No motion added.

## Reviewed by eye and left as is

Teacher home, courses, questions/exams, codes, student home and login at 390px (full-page screenshots)
read well: clear hierarchy, icon-led controls, summary tiles instead of text walls, readable Arabic
typography, no clipped text. No restyling was done there.

## Not fixed, and why

- **H6 focus indicator (about 30 screens)**: this is a harness artifact. The check calls
  `element.focus()` from script, which does not match `:focus-visible` after mouse navigation. With real
  keyboard Tab (30 presses on the teacher courses screen at 390px) every element showed a 2px outline
  or ring and matched `:focus-visible`. Only `body` (scroll-locked) did not, which is expected.
- **`heading-order` (moderate)**: pages jump from `h1` to `h3`. Fixing it means retagging headings, but a
  lot of CSS is keyed to `h3` selectors, so that risks visual regressions in a presentation-only pass.
- **Soft metrics** (text-wall paragraphs about 212, targets under 44px about 580 per run) are informational
  counts from the harness, essentially unchanged; the 44px rule was only applied where it was clearly a
  primary control on phones.

## Not viewed

- 768px and 1280px screenshots were not looked at by eye (metrics only); dark-mode screenshots were
  not reviewed beyond the metrics. 768 dark and 1280 dark were not run (no dark audit at those widths).
  The "before" run for 1280 dark and 768 dark does not exist either.
- Reduced-motion was audited in light runs only (no H8 failures reported); motion was not changed.
- Admin screens, the real-account (non-demo) flows, exam-taking screens and anything behind real
  payment or auth were not reachable in the local demo and were not audited.
- Repeated the audit in Chromium only; no Safari/Firefox.

## Commands

- `npm run lint` (tsc --noEmit): exit 0.
- `npm run build`: succeeded (exit 0).
- `npm run test:flows`: started from a scratch worktree (the script moves `firebase-applet-config.json`
  aside, so it was never run in the repo). It produced no result within about 25 minutes and was stopped,
  so there is no pass/fail to report. These tests exercise server flows that this change does not touch.
