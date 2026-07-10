# Miras student-flows regression suite

Black-box tests for the student **registration → activation → add-course → course-lifecycle**
engine. They drive the real HTTP API exactly as the app does.

## Run

```bash
npm run test:flows
```

Expected: every group prints `PASS=… FAIL=0` and finally `🎉 ALL FLOW GROUPS PASSED`.

## Safety (never touches production)

`tests/run-flows.sh`:

1. **Refuses to run if a server is already on the port** — so it can never hit your
   live server / production Firestore. Stop any running server first.
2. **Moves `firebase-applet-config.json` aside** while testing → the server runs
   **local-only** on `data/db.json`.
3. **Backs up and restores `data/db.json`**.

A `trap` restores the Firestore config and `data/db.json` on any exit (including Ctrl-C).

## What is covered

`tests/flows.main.mjs` (fresh seed):
- New registration: in-roster + valid code = success; not-in-roster / wrong / revoked /
  expired / no-deviceToken / other-student-device = reject.
- Existing student: activated account blocked from the register screen (guided to login);
  login same device after IP change = success; wrong password = reject; add same-teacher and
  other-teacher courses (in roster) = success, previous courses kept, owners isolated;
  not-in-roster code = clear actionable reject; other student's used code = reject;
  re-enter own code = handled; different device = reject/approval.
- **Multi-teacher new-student journey (A+B+C+D):** activate the platform with the first code,
  then all enrolled courses appear — the un-activated ones LOCKED with their name + correct
  owner — and each opens with its own code.
- Free **single-course** codes resolve to their one course (incl. for a multi-course student);
  device transfer adopts the new device and rejects the retired one.

`tests/flows.lifecycle.mjs` (fresh seed):
- Ghost (deleted / renamed-number) courses are hidden; never shown as a bare number or email.
- Renamed course shows the new name; old code does not linger.
- `remove-course` removes the course and it does not re-appear; other courses keep their names.
- Teacher isolation: a teacher cannot remove another teacher's course.

`tests/flows.grading.mjs` (fresh seed) — guards the silent grade-loss fix:
- Saving a grade persists it and the response echoes the saved value.
- The grade round-trips on a fresh read (no "saved then gone").
- Re-grading upserts the same row (no duplicate submissions).
- An over-max grade is rejected with a real 4xx (so the client can show a truthful
  error instead of a false success) and the stored grade stays intact.
- The grade endpoint is teacher-session gated — an unauthenticated save is rejected.

`tests/flows.student-submit.mjs` (fresh seed) — the student submitting their own work:
- No student session cannot submit (401); a student cannot submit for another student.
- Only project/exercise kinds are accepted (else 400).
- A valid submission saves, but the server force-blanks every grade field and
  neutralizes a "returned" status — a student can never grade or return themselves.
- The saved work reaches the teacher's unified submissions view (with no student-set grade).

`tests/flows.quiz-grading.mjs` (fresh seed) — exam auto-grading (the scoring engine):
- A correct answer earns full marks; a wrong answer to the same exam earns zero.
- Per-question correctness and points-earned are reported.
- A submitted exam locks — it cannot be retaken (409) without a teacher return.

`tests/flows.exam-create.mjs` (fresh seed) — the teacher creating an exam:
- A valid exam is created and returned; it appears in the enrolled student's live
  state (absent before) and lands in their notification inbox ("new exam" bell).
- Missing fields (400) and no teacher session (401) are rejected.
- Asking for more questions than the bank holds is rejected (400) with the counts.
- A teacher cannot publish an exam into another teacher's course (isolation).

`tests/flows.notifications.mjs` (fresh seed) — notification relevance (both halves of
the owner's original complaint); guards the 2026-07-08 delivery-gate fix:
- Publishing a new exam AND a new project each reach the enrolled student's bell.
- Renaming a course takes effect (new name shows in the student's state) yet
  produces NO bell notification — silent, no administrative noise.

`tests/flows.grade-release.mjs` (fresh seed) — the grade withhold/release workflow:
- After submit the teacher sees the real grade but the student-facing visibleGrade
  is blank (withheld until release).
- Only the owning teacher may release grades (others get 403).
- Releasing reveals visibleGrade (== grade) and notifies the student ("grade published").

The fixture lives in `tests/seed.cjs`.
