import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BRIDGE_UPDATED_EVENT,
  dispatchBridgeUpdated,
  resetBridgeUpdatedDispatchForTests,
} from '../src/shared/bridge-updated-event';

function fakeTarget() {
  let count = 0;
  const target = {
    dispatchEvent(event: Event) {
      assert.equal(event.type, BRIDGE_UPDATED_EVENT);
      count += 1;
      return true;
    },
  };
  return { target, getCount: () => count };
}

test('a burst of saves (bulk grading) collapses into a single dispatch', async () => {
  resetBridgeUpdatedDispatchForTests();
  const { target, getCount } = fakeTarget();
  for (let i = 0; i < 40; i += 1) dispatchBridgeUpdated(target);
  assert.equal(getCount(), 0, 'dispatch is deferred, not immediate');
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(getCount(), 1, 'the whole burst only triggers one event');
});

test('two separate bursts far apart each still dispatch', async () => {
  resetBridgeUpdatedDispatchForTests();
  const { target, getCount } = fakeTarget();
  dispatchBridgeUpdated(target);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(getCount(), 1);
  dispatchBridgeUpdated(target);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(getCount(), 2);
});

test('no-op without a target (e.g. non-browser context)', () => {
  resetBridgeUpdatedDispatchForTests();
  assert.doesNotThrow(() => dispatchBridgeUpdated(undefined));
});
