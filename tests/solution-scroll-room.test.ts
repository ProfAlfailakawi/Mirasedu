import test from 'node:test';
import assert from 'node:assert/strict';
import { solutionNeedsBottomRoom, SOLUTION_BOTTOM_ROOM_PX } from '../src/shared/solution-scroll-room';

test('an answer that overflows the view gets bottom room', () => {
  assert.equal(solutionNeedsBottomRoom(720, 600, false), true);
});
test('a short answer that fits is left untouched', () => {
  assert.equal(solutionNeedsBottomRoom(600, 600, false), false);
  assert.equal(solutionNeedsBottomRoom(605, 600, false), false);
});
test('our own room does not make a short answer look long', () => {
  assert.equal(solutionNeedsBottomRoom(600 + SOLUTION_BOTTOM_ROOM_PX, 600, true), false);
});
test('a long answer keeps the room once applied', () => {
  assert.equal(solutionNeedsBottomRoom(720 + SOLUTION_BOTTOM_ROOM_PX, 600, true), true);
});
