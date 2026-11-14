import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_STORE_URL, PLAY_STORE_URL, canOfferInstall, detectInstallPlatform,
  installStoreUrl, shouldShowManualInstallBanner,
} from '../src/shared/install-banner';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
const urls = { appStore: 'https://apps.apple.com/app/id1', playStore: '' };

test('platform detection', () => {
  assert.equal(detectInstallPlatform(IPHONE, 5), 'ios');
  assert.equal(detectInstallPlatform(IPAD_AS_MAC, 5), 'ios');
  assert.equal(detectInstallPlatform(DESKTOP, 0), 'desktop');
  assert.equal(detectInstallPlatform(ANDROID, 5), 'android');
});

test('inside the iOS native shell nothing is offered', () => {
  const env = { userAgent: IPHONE, maxTouchPoints: 5, nativeShell: true };
  assert.equal(canOfferInstall(env), false);
  assert.equal(shouldShowManualInstallBanner(env), false);
  assert.equal(installStoreUrl(env, urls), null);
});

test('iOS browser: manual banner shown, button opens the App Store', () => {
  for (const [ua, t] of [[IPHONE, 5], [IPAD_AS_MAC, 5]] as const) {
    const env = { userAgent: ua, maxTouchPoints: t, nativeShell: false };
    assert.equal(canOfferInstall(env), true);
    assert.equal(shouldShowManualInstallBanner(env), true);
    assert.equal(installStoreUrl(env, urls), urls.appStore);
  }
});

test('Android: PWA prompt until a Play URL is set, then the store', () => {
  const env = { userAgent: ANDROID, maxTouchPoints: 5, nativeShell: false };
  assert.equal(shouldShowManualInstallBanner(env), false);
  assert.equal(installStoreUrl(env, urls), null);
  assert.equal(installStoreUrl(env, { ...urls, playStore: 'https://play.google.com/store/apps/details?id=x' }), 'https://play.google.com/store/apps/details?id=x');
});

test('desktop is unchanged', () => {
  const env = { userAgent: DESKTOP, maxTouchPoints: 0, nativeShell: false };
  assert.equal(canOfferInstall(env), true);
  assert.equal(shouldShowManualInstallBanner(env), false);
  assert.equal(installStoreUrl(env, urls), null);
});

test('constants', () => {
  assert.equal(APP_STORE_URL, 'https://apps.apple.com/app/id6834583275');
  assert.equal(PLAY_STORE_URL, '');
});
