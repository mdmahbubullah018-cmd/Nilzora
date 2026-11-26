/*
 * Workspace colour theme
 * ----------------------
 * The admin and moderator workspaces offer a light and a dark theme, or "system", which
 * follows the device. The choice (the *preference*) lives in a plain cookie: not HttpOnly
 * (the theme menu writes it in the browser), SameSite=Lax, for the whole app, for a year.
 * It is not a credential and grants nothing.
 *
 * The root layout reads the cookie on the server and renders <html> with
 * `data-theme-preference` (what was chosen) and `data-theme` (what to paint). For an
 * explicit light or dark choice the server already knows the answer; for "system" it
 * paints light and THEME_SCRIPT, which runs in <head> before the first paint, swaps in
 * the device's scheme — so no visitor ever sees a flash of the wrong theme. Anything
 * unexpected in the cookie reads as "system".
 *
 * Kept free of Next.js and server-only imports: the layout and the client menu share it.
 */

/** The themes a page can be painted in. */
export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** What a visitor can choose: one of the themes, or whatever the device prefers. */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

export const THEME_COOKIE = 'nza_theme';

/** One year, in seconds. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** The painted theme an attribute value names; anything else is light. */
export function parseTheme(value: string | null | undefined): Theme {
  return value === 'dark' ? 'dark' : 'light';
}

/** The preference a cookie value names; missing or unknown values follow the device. */
export function parseThemePreference(value: string | null | undefined): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
    ? value
    : DEFAULT_THEME_PREFERENCE;
}

/**
 * The theme the server paints for a preference. "system" cannot be known on the server,
 * so it starts light and THEME_SCRIPT corrects it before the first paint.
 */
export function serverTheme(preference: ThemePreference): Theme {
  return preference === 'dark' ? 'dark' : 'light';
}

/** The theme a preference resolves to, given whether the device prefers dark. */
export function resolveTheme(preference: ThemePreference, deviceDark: boolean): Theme {
  if (preference === 'system') return deviceDark ? 'dark' : 'light';
  return preference;
}

/**
 * The `document.cookie` assignment that stores `preference`. `secure` adds the Secure
 * attribute (pass true on HTTPS pages).
 */
export function themeCookie(
  preference: ThemePreference,
  { secure = false }: { secure?: boolean } = {},
): string {
  const attributes = [
    `${THEME_COOKIE}=${preference}`,
    'Path=/',
    `Max-Age=${String(THEME_COOKIE_MAX_AGE)}`,
    'SameSite=Lax',
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

/**
 * When the preference is "system", paints the device's scheme, and keeps following it
 * while the page is open (a laptop switching to dark at sunset). Self-contained — it uses
 * only globals — so its source can be inlined as THEME_SCRIPT.
 */
export function followDeviceTheme(): void {
  try {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      if (root.dataset.themePreference === 'system') {
        root.dataset.theme = media.matches ? 'dark' : 'light';
      }
    };
    apply();
    media.addEventListener('change', apply);
  } catch {
    // No matchMedia (very old browsers): the server's light paint stands.
  }
}

/** Runs in <head>, before anything is painted. A fixed string with no user input in it. */
export const THEME_SCRIPT = `(${followDeviceTheme.toString()})();`;
