import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isLikelyUnsupportedExamWebViewUA } from '../src/shared/exam-webview';

const APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const FB = 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/400]';
const ANDROID_WV = 'Mozilla/5.0 (Linux; Android 13; Pixel; wv) AppleWebKit/537.36 Version/4.0 Chrome/120.0 Mobile Safari/537.36';

test('in the iOS app the exam is allowed (not flagged as unsupported WebView)', () => {
  assert.equal(isLikelyUnsupportedExamWebViewUA(APP_UA, true), false);
});

test('in a browser the behaviour is unchanged', () => {
  assert.equal(isLikelyUnsupportedExamWebViewUA(APP_UA, false), true);
  assert.equal(isLikelyUnsupportedExamWebViewUA(FB, false), true);
  assert.equal(isLikelyUnsupportedExamWebViewUA(ANDROID_WV, false), true);
  assert.equal(isLikelyUnsupportedExamWebViewUA(SAFARI, false), false);
});

test('App.tsx delegates to the shared helper with the native detector', () => {
  const src = fs.readFileSync('App.tsx', 'utf8');
  assert.match(src, /isLikelyUnsupportedExamWebViewUA\(\s*String\(navigator\.userAgent \|\| ""\),\s*isAppleNativeShell\(\),?\s*\)/);
});
