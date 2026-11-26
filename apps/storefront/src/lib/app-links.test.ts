import { describe, expect, it } from 'vitest';
import {
  appDownloadLinks,
  appStoreUrl,
  hasAppAction,
  NO_APP_LINKS,
  playStoreUrl,
} from './app-links';

const PLAY = 'https://play.google.com/store/apps/details?id=com.nilzora.app';
const APPLE = 'https://apps.apple.com/bd/app/nilzora/id123456789';

describe('appDownloadLinks', () => {
  it('has nothing to offer without a profile (the app areas stay hidden)', () => {
    expect(appDownloadLinks()).toEqual(NO_APP_LINKS);
    expect(appDownloadLinks(null)).toEqual(NO_APP_LINKS);
    expect(hasAppAction(appDownloadLinks())).toBe(false);
  });

  it('has nothing to offer for a profile that published no listing', () => {
    const links = appDownloadLinks({ playStoreUrl: null, appStoreUrl: undefined });

    expect(links).toEqual(NO_APP_LINKS);
    expect(hasAppAction(links)).toBe(false);
  });

  it('offers the listings the store published', () => {
    const links = appDownloadLinks({ playStoreUrl: PLAY, appStoreUrl: APPLE });

    expect(links).toEqual({ googlePlayUrl: PLAY, appStoreUrl: APPLE });
    expect(hasAppAction(links)).toBe(true);
    expect(hasAppAction(appDownloadLinks({ playStoreUrl: PLAY, appStoreUrl: null }))).toBe(true);
    expect(hasAppAction(appDownloadLinks({ playStoreUrl: null, appStoreUrl: APPLE }))).toBe(true);
  });

  it('drops a link that is not on the expected store, whatever the profile holds', () => {
    const links = appDownloadLinks({
      playStoreUrl: 'https://play.google.com.evil.example/app',
      appStoreUrl: 'http://apps.apple.com/app/x',
    });

    expect(links).toEqual(NO_APP_LINKS);
  });
});

describe('store links', () => {
  it.each([
    ['https://play.google.com/store/apps', true],
    ['https://user:pw@play.google.com/store', false],
    ['http://play.google.com/store', false],
    ['https://apps.apple.com/app/x', false],
    ['javascript:alert(1)', false],
    ['', false],
  ])('playStoreUrl(%s) is accepted: %s', (value, accepted) => {
    expect(playStoreUrl(value) !== null).toBe(accepted);
  });

  it('accepts only Apple’s App Store host for the iPhone button', () => {
    expect(appStoreUrl(APPLE)).toBe(APPLE);
    expect(appStoreUrl(PLAY)).toBeNull();
  });
});
