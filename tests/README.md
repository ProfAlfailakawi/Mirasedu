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

The fixture lives in `tests/seed.cjs`.
