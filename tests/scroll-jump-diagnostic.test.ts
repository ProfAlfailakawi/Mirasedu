import test from 'node:test';
import assert from 'node:assert/strict';
import { createScrollJumpDetector, formatScrollJumpReport } from '../src/shared/scroll-jump-diagnostic';

test('a snap to the top with no finger on the screen is reported', () => {
  const d = createScrollJumpDetector();
  assert.equal(d.scroll(1000, 0), null);
  assert.equal(d.scroll(1016, 90), null);
  const jump = d.scroll(1032, 0, 700, 600);
  assert.ok(jump);
  assert.equal(jump!.fromTop, 90);
  assert.equal(jump!.toTop, 0);
  assert.equal(jump!.touchActive, false);
  assert.equal(jump!.scrollHeight, 700);
});

test('dragging the content back to the top with a finger is normal, not a jump', () => {
  const d = createScrollJumpDetector();
  d.scroll(1000, 120);
  d.touchStart(1005);
  d.touchMove(1010);
  assert.equal(d.scroll(1016, 0), null);
});

test('a stale touch flag (finger stopped long ago) does not hide a snap', () => {
  const d = createScrollJumpDetector();
  d.scroll(1000, 120);
  d.touchStart(1001);
  d.touchMove(1005);
  assert.ok(d.scroll(2000, 0));
});

test('a snap that lands a few pixels below the top (fling still running) is still a jump', () => {
  const d = createScrollJumpDetector();
  d.scroll(1000, 2000);
  assert.ok(d.scroll(1016, 22));
});

test('a normal scroll step is not a jump', () => {
  const d = createScrollJumpDetector();
  d.scroll(1000, 300);
  assert.equal(d.scroll(1016, 260), null);
});

test('small moves and positions near the top are ignored', () => {
  const d = createScrollJumpDetector();
  d.scroll(1000, 30);
  assert.equal(d.scroll(1016, 0), null);
});

test('a finger lifted just before a snap still reports it (momentum cannot jump to the top)', () => {
  const d = createScrollJumpDetector();
  d.scroll(1000, 100);
  d.touchStart(1001);
  d.touchEnd(1008);
  const jump = d.scroll(1030, 0);
  assert.ok(jump);
  assert.equal(jump!.msSinceTouchEnd, 22);
});

test('the report lists each jump with its context', () => {
  const text = formatScrollJumpReport(
    [{ at: 'T', fromTop: 90, toTop: 0, msSincePrevScroll: 16, touchActive: false, msSinceTouchMove: null, msSinceTouchEnd: 22, scrollHeight: 700, clientHeight: 600, context: { الشاشة: 'x' } }],
    { الجهاز: 'iPhone' },
  );
  assert.match(text, /الجهاز: iPhone/);
  assert.match(text, /من 90 إلى 0/);
  assert.match(text, /الشاشة: x/);
});
