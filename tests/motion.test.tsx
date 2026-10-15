/*
 * Calm-motion primitives: with no IntersectionObserver / DOM (server render, tests) every
 * effect must show its FINAL state, with no motion attributes and no intermediate numbers.
 * Browser-only parts (observer, timers, rAF) are covered by the live checks in the PR.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

register('data:text/javascript,' + encodeURIComponent(
  "export async function load(u,c,n){ if(u.endsWith('.css')) return {format:'module',source:'',shortCircuit:true}; return n(u,c); }",
));
const motion = await import('../src/design/motion');
const { DnaStat, DnaRing, DnaHeat, DnaLive, DnaStepper, DnaHubMap } = await import('../src/design/DnaKit');
const { DnaCountUp, DnaCountText, DnaMotionGroup, DnaChangeMark, canPlayMotion } = motion;
const html = (el: React.ReactElement) => renderToStaticMarkup(el);

test('nothing is armed without a browser (no observer): final state only', () => {
  assert.equal(canPlayMotion('x'), false);
  assert.equal(canPlayMotion(), false);
});

test('count-up renders the final text, once, with no hidden duplicate', () => {
  const h = html(<DnaCountUp value={1234} format={(n) => n.toLocaleString('en-US')} playKey="k" />);
  assert.match(h, />1,234</);
  assert.doesNotMatch(h, /dna-sr/);
  assert.doesNotMatch(h, /data-cu=/);
});

test('count text only takes plain counts; everything else is returned untouched', () => {
  assert.match(html(<DnaCountText text="42" />), />42</);
  assert.match(html(<DnaCountText text="63%" />), />63%</);
  assert.match(html(<DnaCountText text="8.50" />), />8\.50</);
  assert.equal(html(<DnaCountText text="٤٢" />), '٤٢');
  assert.equal(html(<DnaCountText text="3 من 10" />), '3 من 10');
  assert.equal(html(<DnaCountText text="—" />), '—');
});

test('a motion group shows the rest state and passes its attributes through', () => {
  const h = html(
    <DnaMotionGroup playKey="g" className="card" role="img" aria-label="x" data-reveal-target="t">
      <DnaCountText text="7" />
    </DnaMotionGroup>,
  );
  assert.doesNotMatch(h, /data-draw/);
  assert.match(h, /class="card"/);
  assert.match(h, /role="img"/);
  assert.match(h, /data-reveal-target="t"/);
  assert.match(h, />7</);
});

test('stat, ring, heat strip and live dot keep their real content', () => {
  assert.match(html(<DnaStat icon={null} label="a" value={12} countUp="s" />), /<strong class="dna-statv">.*12/);
  assert.match(html(<DnaStat icon={null} label="a" value="—" countUp="s" />), />—</);
  const ring = html(<DnaRing value={40} />);
  assert.match(ring, /stroke-dasharray="[\d.]+ [\d.]+"/);
  assert.doesNotMatch(ring, /data-draw/);
  const heat = html(<DnaHeat reveal="h" cells={[{ key: 'a', value: 1 }, { key: 'b', value: 0 }]} />);
  assert.doesNotMatch(heat, /data-draw|--d:/);
  assert.match(html(<DnaLive label="مباشر" />), /data-on="true"/);
  assert.doesNotMatch(html(<DnaLive label="مباشر" />), /data-pulse/);
});

test('change mark and advance steppers render nothing extra on first paint', () => {
  assert.equal(html(<DnaChangeMark signal={3} memoryKey="m" />), '');
  const steps = [
    { key: 'a', label: 'A', state: 'done' as const },
    { key: 'b', label: 'B', state: 'current' as const },
    { key: 'c', label: 'C', state: 'pending' as const },
  ];
  const h = html(<DnaStepper still advance="public-login:test" steps={steps} />);
  assert.deepEqual([...h.matchAll(/data-state="(\w+)"/g)].map((m) => m[1]), ['done', 'current', 'pending']);
  assert.doesNotMatch(h, /data-advance|data-just/);
});

test('hub map first paint carries no highlight', () => {
  const h = html(<DnaHubMap center={{ value: 5 }} nodes={[{ key: 'a', icon: null, label: 'A', value: 2 }]} live={{ on: true, label: 'x' }} animate={false} />);
  assert.doesNotMatch(h, /data-flash|data-pulse/);
});
