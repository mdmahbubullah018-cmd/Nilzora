// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  followDeviceTheme,
  parseTheme,
  parseThemePreference,
  resolveTheme,
  serverTheme,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  THEME_SCRIPT,
  themeCookie,
} from './theme';

describe('parseTheme', () => {
  it('reads the painted theme and treats anything else as light', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
    for (const value of [undefined, null, '', 'DARK', 'system', 'dark; Path=/']) {
      expect(parseTheme(value)).toBe('light');
    }
  });
});

describe('parseThemePreference', () => {
  it('reads the three choices and follows the device for anything else', () => {
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('system')).toBe('system');
    for (const value of [undefined, null, '', 'DARK', 'auto', 'dark; Path=/']) {
      expect(parseThemePreference(value)).toBe('system');
    }
  });
});

describe('serverTheme and resolveTheme', () => {
  it('paints explicit choices on the server and starts "system" light', () => {
    expect(serverTheme('dark')).toBe('dark');
    expect(serverTheme('light')).toBe('light');
    expect(serverTheme('system')).toBe('light');
  });

  it('resolves "system" from the device and keeps explicit choices', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('followDeviceTheme and THEME_SCRIPT', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function run(preference: string, deviceDark: boolean) {
    const root = document.documentElement;
    root.dataset.themePreference = preference;
    root.dataset.theme = 'light';
    const listeners: (() => void)[] = [];
    const media = {
      matches: deviceDark,
      addEventListener: (_: string, listener: () => void) => listeners.push(listener),
    };
    vi.stubGlobal('matchMedia', () => media);
    followDeviceTheme();
    return { root, media, listeners };
  }

  it('paints the device scheme before first paint when the preference is "system"', () => {
    expect(run('system', true).root.dataset.theme).toBe('dark');
    expect(run('system', false).root.dataset.theme).toBe('light');
  });

  it('leaves an explicit choice alone', () => {
    expect(run('light', true).root.dataset.theme).toBe('light');
  });

  it('follows the device while the page stays open', () => {
    const { root, media, listeners } = run('system', false);
    media.matches = true;
    for (const listener of listeners) listener();
    expect(root.dataset.theme).toBe('dark');
  });

  it('keeps the server paint when the browser has no matchMedia', () => {
    const root = document.documentElement;
    root.dataset.themePreference = 'system';
    root.dataset.theme = 'light';
    vi.stubGlobal('matchMedia', undefined);
    expect(() => followDeviceTheme()).not.toThrow();
    expect(root.dataset.theme).toBe('light');
  });

  it('inlines exactly that function, invoked once', () => {
    expect(THEME_SCRIPT.startsWith('(')).toBe(true);
    expect(THEME_SCRIPT.endsWith(')();')).toBe(true);
    expect(THEME_SCRIPT).toContain(followDeviceTheme.toString());
  });
});

describe('themeCookie', () => {
  it('stores a long-lived, site-wide, SameSite=Lax preference', () => {
    expect(THEME_COOKIE).toBe('nza_theme');
    expect(themeCookie('dark')).toBe(
      `nza_theme=dark; Path=/; Max-Age=${String(THEME_COOKIE_MAX_AGE)}; SameSite=Lax`,
    );
    expect(themeCookie('system')).toContain('nza_theme=system');
    expect(THEME_COOKIE_MAX_AGE).toBe(31_536_000);
  });

  it('adds Secure on HTTPS pages', () => {
    expect(themeCookie('light', { secure: true }).endsWith('; Secure')).toBe(true);
  });

  it('is never HttpOnly, because the theme menu writes it in the browser', () => {
    expect(themeCookie('dark', { secure: true })).not.toMatch(/HttpOnly/i);
  });
});
