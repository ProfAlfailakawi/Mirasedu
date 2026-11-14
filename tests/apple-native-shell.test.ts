import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isAppleNativeShell } from '../src/shared/apple-native-shell';

const g = globalThis as any;
const withWindow = (win: any, fn: () => void) => {
  const had = 'window' in g; const prev = g.window;
  g.window = win;
  try { fn(); } finally { if (had) g.window = prev; else delete g.window; }
};

test('isAppleNativeShell is false without a window (SSR/tests)', () => {
  assert.equal(isAppleNativeShell(), false);
});

test('isAppleNativeShell is false on the website and on Android', () => {
  withWindow({}, () => assert.equal(isAppleNativeShell(), false));
  withWindow({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }, () => assert.equal(isAppleNativeShell(), false));
  withWindow({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }, () => assert.equal(isAppleNativeShell(), false));
});

test('isAppleNativeShell is true only for native iOS', () => {
  withWindow({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }, () => assert.equal(isAppleNativeShell(), true));
});

test('the demo entry button is gated on the iOS shell, not a constant', () => {
  const src = fs.readFileSync('App.tsx', 'utf8');
  assert.match(src, /const MIRAS_DEMO_ENTRY_VISIBLE = isAppleNativeShell\(\);/);
  assert.doesNotMatch(src, /const MIRAS_DEMO_ENTRY_VISIBLE = (true|false);/);
});
