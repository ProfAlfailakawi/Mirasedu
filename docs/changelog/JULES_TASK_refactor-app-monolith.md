# Jules Task — Safe strangler refactor of Miras `App.tsx` monolith

## Context
`App.tsx` (root, ~44,700 lines / 2.1 MB) and `server.ts` (~23,300 lines) are monolithic.
The app entry is `src/main.tsx` → `import App from '../App.tsx'`. There are **no frontend
unit tests**; the only behavior oracle is the backend flow suite:
`npm run test:flows` (bash `tests/run-flows.sh`, local-only, safe, backs up `data/db.json`).

**CRITICAL WORKFLOW CONSTRAINT:** Root `App.tsx` and `index.css` are periodically
re-uploaded/regenerated from **Google AI Studio**, which treats them as the single source
of truth for that file. Therefore extraction must NOT assume `App.tsx` is hand-maintained
forever. Extract only into `src/features/**` and `src/shared/**` modules that are *imported*
by `App.tsx`; keep the import surface small and stable so an AI Studio re-upload only needs
to preserve the import block, not the moved code.

## Goal
Incrementally extract cohesive, **side-effect-free** units out of `App.tsx` into feature
modules — WITHOUT any behavior change — establishing a `src/features/**` + `src/shared/**`
structure. Pure functions, constants, and types first. No large stateful component should be
moved in this task.

## Hard rules
1. **No behavior change.** Only move code + add imports. Do not rewrite logic, rename exports
   used elsewhere, or change function signatures.
2. **One module per PR.** Each PR extracts exactly one cohesive group, and must:
   - keep `App.tsx` compiling (`npm run lint` = `tsc --noEmit` passes),
   - pass `npm run build` (vite + esbuild),
   - pass `npm run test:flows` (all 12 groups green),
   - contain a diff that is *only* a cut-from-App.tsx + paste-into-module + one import line.
3. Never touch `server.ts`, `server.cjs`, `data/db.json`, or the `tests/` behavior in the
   same PR as an extraction.
4. Preserve `"use client"`-style module-scope ordering: if a moved helper reads a
   module-scope const, move that const too or import it — never leave a dangling reference.

## Suggested extraction order (safest → riskier), each its own PR
1. `src/shared/arabic-text.ts` — `normalizeArabicIndicDigits`, `stripArabicIndicDigitsFromInput`,
   `MIRAS_AR2LAT`, `mirasPhoneticSkeleton`, `mirasPhoneticWordMatch`.
2. `src/features/submissions/file-rules.ts` — `MIRAS_ALLOWED_SUBMISSION_*`,
   `MIRAS_MAX_*`, `mirasFileExtension`, `validateMirasSubmissionFileFormat`,
   `mirasCleanAttachmentName`, `repairMirasMisdecodedArabicFilename`.
3. `src/features/deadlines/deadline.ts` — `mirasDeadlineEndMs`, `mirasIsPastDeadline`,
   `todayDateInputValue`.
4. `src/features/vision/local-vision.ts` — `DEFAULT_LOCAL_VISION_CONFIG`,
   `normalizeLocalVisionConfig`, `localVisionModeLabel`, `localVisionCameraPolicyLabel`,
   `localVisionPulseLabel`, `localVisionGuidance`, `mirasExamUsesCamera`.
5. `src/features/passkey/local-lock.ts` — the `MIRAS_PASSKEY_*` block and its readers/writers
   (`readMirasPasskeyLocalLock` … `storedSessionNeedsPasskeyUnlock`).
6. `src/shared/user-messages.ts` — `safeUserFacingErrorText`, `extractApiErrorReason`,
   `simplifyStudentMessage`, `simplifyMirasMessage`, `truncateMirasMessage`,
   `compactMirasDialogMessage`.
7. `src/features/join-codes/records.ts` — `isLiveRecord`, `isArchivedJoinCodeRecord`,
   `isLiveJoinCodeRecord`, `isRecentlyIssuedJoinCodeRecord`, `mergeRosterRowsById`,
   `allowedRosterRowsToText`.

## Per-PR checklist (paste into each PR description)
- [ ] Only cut/paste + import; no logic edits (`git diff` reviewed line-by-line)
- [ ] `npm run lint` clean
- [ ] `npm run build` clean
- [ ] `npm run test:flows` → all 12 groups PASS
- [ ] No change to `server.ts` / `data/db.json` / `tests/`
- [ ] New module has a top-of-file comment noting it was extracted from `App.tsx`

## Out of scope (do NOT do here)
- Extracting React components with state/effects.
- Splitting `server.ts`.
- Any dependency upgrade or lint-rule change.
