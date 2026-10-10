import test from 'node:test';
import assert from 'node:assert/strict';
import {
  journeyTarget,
  journeyStepMs,
  journeyDisplayState,
  journeyAlreadyPlayed,
  journeyMarkPlayed,
  journeyResetPlayed,
  submissionJourneyProps,
} from '../src/design/journeyReveal';
import { publicDeviceLoginSteps, publicLoginApprovalSteps } from '../src/design/publicLoginJourney';

const st = (...s: string[]) => s.map((state) => ({ state: state as any }));

test('target is the last really-lit station, never a pending/returned/blocked one', () => {
  assert.equal(journeyTarget(st('done', 'done', 'current', 'pending')), 3);
  assert.equal(journeyTarget(st('done', 'returned', 'pending', 'pending')), 1);
  assert.equal(journeyTarget(st('done', 'blocked', 'pending', 'pending')), 1);
  assert.equal(journeyTarget(st('pending', 'pending')), 0);
});

test('pace is clamped and the whole intro stays near 4.5s', () => {
  assert.equal(journeyStepMs(3), 750);
  assert.equal(journeyStepMs(4), 750);
  assert.equal(journeyStepMs(8), 500);
  assert.equal(journeyStepMs(40), 350);
  for (const n of [2, 4, 6, 10]) assert.ok(journeyStepMs(n) * n <= 4600);
});

test('intro never shows a state further along than the truth', () => {
  const real = ['done', 'done', 'current', 'pending'] as const;
  for (let lit = 0; lit <= 4; lit++) {
    real.forEach((r, i) => {
      const shown = journeyDisplayState(r, i, lit);
      assert.ok(shown === r || shown === 'pending');
      if (i >= lit) assert.equal(shown, 'pending');
    });
  }
  // settled = real states
  real.forEach((r, i) => assert.equal(journeyDisplayState(r, i, null), r));
});

test('returned / blocked are never filled, they just appear after the previous station', () => {
  assert.equal(journeyDisplayState('returned', 1, 0), 'pending');
  assert.equal(journeyDisplayState('returned', 1, 1), 'returned');
  assert.equal(journeyDisplayState('blocked', 1, 1), 'blocked');
});

test('playKey is remembered so remounts do not replay', () => {
  journeyResetPlayed();
  assert.equal(journeyAlreadyPlayed('submission:1'), false);
  journeyMarkPlayed('submission:1');
  assert.equal(journeyAlreadyPlayed('submission:1'), true);
  assert.equal(journeyAlreadyPlayed('submission:2'), false);
  assert.equal(journeyAlreadyPlayed(undefined), false);
});

test('an in-progress exam gets no intro and no pulse', () => {
  assert.deepEqual(submissionJourneyProps({ id: 7 }, true), { reveal: false, still: true, playKey: 'submission:7' });
  assert.deepEqual(submissionJourneyProps({ id: 7 }, false), { reveal: true, still: false, playKey: 'submission:7' });
  assert.equal(submissionJourneyProps({}, false).playKey, undefined);
});

test('public-device login stations follow the phase, never time', () => {
  const states = (p: string, r = true) => publicDeviceLoginSteps(p, r)!.map((s) => s.state);
  assert.deepEqual(states('waiting'), ['done', 'current', 'pending', 'pending']);
  assert.deepEqual(states('connecting'), ['done', 'done', 'done', 'current']);
  assert.deepEqual(states('expired'), ['done', 'blocked', 'pending', 'pending']);
  assert.deepEqual(states('error', false), ['blocked', 'pending', 'pending', 'pending']);
  assert.equal(publicDeviceLoginSteps('idle', false), null);
  assert.deepEqual(publicLoginApprovalSteps('ready')!.map((s) => s.state), ['done', 'done', 'current', 'pending']);
  assert.equal(publicLoginApprovalSteps('loading'), null);
});
