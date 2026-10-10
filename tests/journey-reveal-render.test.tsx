/*
 * Behavioural checks for <DnaStepper> that need no DOM: server rendering shows
 * the REAL states (the intro only ever starts in the browser), and the helpers
 * that decide motion are exercised directly. The browser-only parts (timers,
 * IntersectionObserver) are covered by the live checks described in the PR.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { journeyIsCovered, submissionJourneyProps, journeyAlreadyPlayed, journeyResetPlayed } from '../src/design/journeyReveal';

// stylesheets are bundler-only: let the node runner load the component without them
register('data:text/javascript,' + encodeURIComponent(
  "export async function load(u,c,n){ if(u.endsWith('.css')) return {format:'module',source:'',shortCircuit:true}; return n(u,c); }",
));
const { DnaStepper } = await import('../src/design/DnaKit');

const steps = [
  { key: 'a', label: 'قيد الحل', state: 'done' as const },
  { key: 'b', label: 'سُلِّم', state: 'returned' as const },
  { key: 'c', label: 'رُصدت', state: 'pending' as const },
];
const html = (el: React.ReactElement) => renderToStaticMarkup(el);
const states = (h: string) => [...h.matchAll(/data-state="(\w+)"/g)].map((m) => m[1]);

test('reveal mode renders the real states on the server (no hidden/unlit first paint)', () => {
  const h = html(<DnaStepper reveal playKey="submission:1" steps={steps} />);
  assert.deepEqual(states(h), ['done', 'returned', 'pending']);
  assert.match(h, /data-reveal="done"/);
  assert.doesNotMatch(h, /data-just/);
});

test('screen-reader text and aria-current follow the real state, not the animation', () => {
  const h = html(<DnaStepper reveal steps={[{ key: 'a', label: 'A', state: 'done' }, { key: 'b', label: 'B', state: 'current' }]} />);
  assert.match(h, /aria-current="step"/);
  assert.equal((h.match(/class="dna-sr"/g) || []).length, 2);
});

test('still never arms a reveal and marks itself still', () => {
  const props = submissionJourneyProps({ id: 9 }, true);
  const h = html(<DnaStepper {...props} steps={[{ key: 'a', label: 'A', state: 'current' }]} />);
  assert.match(h, /data-still="true"/);
  assert.doesNotMatch(h, /data-journey/);
});

test('plain steppers (no reveal) keep zero journey attributes', () => {
  const h = html(<DnaStepper steps={steps} />);
  assert.doesNotMatch(h, /data-journey|data-reveal|data-still|data-lit/);
});

test('dense rows are static and never use up the main card intro', () => {
  assert.deepEqual(submissionJourneyProps({ id: 5 }, false, true), { reveal: false, still: true, playKey: undefined });
  journeyResetPlayed();
  assert.equal(journeyAlreadyPlayed('submission:5'), false);
});

test('journeyIsCovered: an overlay on top of the stepper is detected, the stepper itself is not', () => {
  const g = globalThis as any;
  const saved = { window: g.window, document: g.document };
  const el: any = { getBoundingClientRect: () => ({ left: 10, right: 110, top: 10, bottom: 60 }), contains: (n: any) => n === el || n === child };
  const child = {};
  const overlay: any = { contains: () => false };
  let top: any = el;
  g.window = { innerWidth: 800, innerHeight: 600 };
  g.document = { documentElement: {}, elementFromPoint: () => top };
  try {
    assert.equal(journeyIsCovered(el), false);
    top = child;
    assert.equal(journeyIsCovered(el), false);
    top = overlay;
    assert.equal(journeyIsCovered(el), true);
    el.getBoundingClientRect = () => ({ left: 10, right: 110, top: 700, bottom: 760 }); // off screen
    assert.equal(journeyIsCovered(el), false);
  } finally {
    g.window = saved.window; g.document = saved.document;
  }
});
