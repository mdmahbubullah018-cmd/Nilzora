import {
  canDetectSpokenLanguage,
  localeForTag,
  otherVoiceLocale,
  setNativeSpeechForTests,
  type NativeSpeech,
} from '@/voice/native-speech';

/*
 * Language handling for voice search, unit-tested where it is pure: which language a reported
 * tag means, which one a second attempt switches to, and whether the recognizer on this build can
 * identify the language itself.
 */

describe('localeForTag', () => {
  it('maps both Bangla models onto the one Bangla locale the store searches in', () => {
    expect(localeForTag('bn-BD', 'en-US')).toBe('bn-BD');
    expect(localeForTag('bn-IN', 'en-US')).toBe('bn-BD');
    expect(localeForTag('BN-bd', 'en-US')).toBe('bn-BD');
  });

  it('maps any English variant onto the English locale', () => {
    expect(localeForTag('en-US', 'bn-BD')).toBe('en-US');
    expect(localeForTag('en-GB', 'bn-BD')).toBe('en-US');
  });

  it('keeps the attempt’s language when the engine names something else', () => {
    expect(localeForTag('ar-SA', 'en-US')).toBe('en-US');
    expect(localeForTag('ar-SA', 'bn-BD')).toBe('bn-BD');
    expect(localeForTag(null, 'bn-BD')).toBe('bn-BD');
    expect(localeForTag(undefined, 'en-US')).toBe('en-US');
  });
});

describe('otherVoiceLocale', () => {
  it('switches to the only other language the store speaks, both ways', () => {
    expect(otherVoiceLocale('en-US')).toBe('bn-BD');
    expect(otherVoiceLocale('bn-BD')).toBe('en-US');
  });
});

describe('canDetectSpokenLanguage', () => {
  afterEach(() => setNativeSpeechForTests(undefined));

  it('is false when this build has no recognizer at all', () => {
    setNativeSpeechForTests(null);
    expect(canDetectSpokenLanguage()).toBe(false);
  });

  it('follows what the installed module reports', () => {
    const module: NativeSpeech = {
      isAvailable: () => true,
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
      canDetectLanguage: () => true,
      addListener: () => ({ remove: () => undefined }),
    };
    setNativeSpeechForTests(module);
    expect(canDetectSpokenLanguage()).toBe(true);

    setNativeSpeechForTests({ ...module, canDetectLanguage: () => false });
    expect(canDetectSpokenLanguage()).toBe(false);
  });

  it('is false for an older installed module that cannot answer the question', () => {
    setNativeSpeechForTests({
      isAvailable: () => true,
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
      addListener: () => ({ remove: () => undefined }),
    });
    expect(canDetectSpokenLanguage()).toBe(false);
  });
});
