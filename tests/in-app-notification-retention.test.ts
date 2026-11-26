import test from 'node:test';
import assert from 'node:assert/strict';
import { pruneInAppNotifications } from '../src/server/db';

const now = Date.parse('2026-11-26T10:00:00Z');
const at = (min: number) => new Date(now - min * 60000).toISOString();

test('other users\' notifications no longer push a recipient\'s alert out of the inbox', () => {
  const mine = { id: 'mine', userId: '1001', role: 'student', createdAt: at(30) };
  const flood = Array.from({ length: 500 }, (_, i) => ({ id: `f${i}`, userId: 'teacher@x.kw', role: 'teacher', createdAt: at(i % 20) }));
  const kept = pruneInAppNotifications([...flood, mine], now);
  assert.ok(kept.some((n) => n.id === 'mine'));
  assert.equal(kept.filter((n) => n.userId === 'teacher@x.kw').length, 60);
});

test('teacher and admin rows share one bucket; course-wide rows are kept per course', () => {
  const rows = [
    ...Array.from({ length: 70 }, (_, i) => ({ id: `t${i}`, userId: 'A@x.kw', role: i % 2 ? 'admin' : 'teacher', createdAt: at(i) })),
    ...Array.from({ length: 70 }, (_, i) => ({ id: `c${i}`, sectionCode: '111', role: 'student', createdAt: at(i) })),
  ];
  const kept = pruneInAppNotifications(rows, now);
  assert.equal(kept.filter((n) => n.id.startsWith('t')).length, 60);
  assert.equal(kept.filter((n) => n.id.startsWith('c')).length, 60);
  assert.equal(kept[0].id, 't0');
});

test('very old notifications are dropped', () => {
  const kept = pruneInAppNotifications([{ id: 'old', userId: '1', createdAt: at(60 * 24 * 50) }, { id: 'new', userId: '1', createdAt: at(1) }], now);
  assert.deepEqual(kept.map((n) => n.id), ['new']);
});
