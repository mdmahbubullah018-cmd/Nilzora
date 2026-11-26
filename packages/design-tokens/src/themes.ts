import { colors } from './colors';

/**
 * Semantic colour roles. The canonical brand values in `colors` never change;
 * roles that carry text use darker shades where a brand value would fall below
 * WCAG AA. Every pairing is verified in themes.test.ts.
 */
export const lightTheme = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: colors.softBackground,
  foreground: colors.navy,
  body: colors.slate,
  /** Secondary text; #64748B was only 4.35:1 on the soft background. */
  mutedForeground: '#475569',
  border: '#E2E8F0',
  borderStrong: colors.mutedSlate,
  /** Form control outlines must reach 3:1 against their surroundings. */
  inputBorder: '#64748B',
  /** Focus indicator on light surfaces (3:1 against white and the soft background). */
  ring: colors.primary,
  /** Focus indicator inside navy or slate surfaces. */
  ringOnDark: colors.sky,
  /** Canonical brand blue for accents, icons and the wordmark. */
  primary: colors.primary,
  /** Filled primary buttons: white on the brand #0284C7 is only 4.1:1. */
  primaryAction: colors.primaryHover,
  primaryActionHover: '#075985',
  primaryActionForeground: '#FFFFFF',
  link: colors.primaryHover,
  dangerAction: '#DC2626',
  dangerActionHover: '#B91C1C',
  dangerActionForeground: '#FFFFFF',
  /** Solid offer badges: white on the brand #F43F5E is only 3.7:1. */
  offerBadge: '#E11D48',
  offerBadgeForeground: '#FFFFFF',
  sidebar: colors.navy,
  sidebarForeground: '#FFFFFF',
  sidebarMuted: colors.mutedSlate,
  sidebarBorder: 'rgb(255 255 255 / 0.08)',
  workspaceAccent: colors.sky,
  workspaceAccentText: colors.sky,
} as const;

export type ThemeRole = keyof typeof lightTheme;
export type ThemeColors = Record<ThemeRole, string>;

/**
 * Dark theme: the brand navy as the page, slate surfaces, soft-slate text and the sky
 * accent for links and focus. Filled actions keep the light theme's accessible shades
 * (white on #0284C7 stays below AA in either theme). Every pairing is verified in
 * themes.test.ts.
 */
export const darkTheme = {
  background: colors.navy,
  surface: '#1E293B',
  surfaceMuted: '#0B1222',
  foreground: colors.softBackground,
  body: colors.mutedSlate,
  mutedForeground: '#94A3B8',
  border: colors.slate,
  borderStrong: '#475569',
  inputBorder: '#7C8BA1',
  ring: colors.sky,
  ringOnDark: colors.sky,
  primary: colors.sky,
  primaryAction: colors.primaryHover,
  primaryActionHover: '#075985',
  primaryActionForeground: '#FFFFFF',
  link: colors.sky,
  dangerAction: '#DC2626',
  dangerActionHover: '#B91C1C',
  dangerActionForeground: '#FFFFFF',
  offerBadge: '#E11D48',
  offerBadgeForeground: '#FFFFFF',
  sidebar: '#0B1222',
  sidebarForeground: '#FFFFFF',
  sidebarMuted: colors.mutedSlate,
  sidebarBorder: 'rgb(255 255 255 / 0.08)',
  workspaceAccent: colors.sky,
  workspaceAccentText: colors.sky,
} as const satisfies ThemeColors;

export type ThemeName = 'light' | 'dark';

/** Every theme defines every role ([data-theme] blocks in tokens.css match these). */
export const themes: Record<ThemeName, ThemeColors> = { light: lightTheme, dark: darkTheme };

/** Overrides applied inside [data-workspace='moderator']: slate chrome, teal accent. */
export const moderatorWorkspace = {
  sidebar: colors.slate,
  sidebarBorder: 'rgb(255 255 255 / 0.1)',
  workspaceAccent: colors.moderator,
  /** Teal-300: the brand teal #14B8A6 is only 4.2:1 as text on slate. */
  workspaceAccentText: '#5EEAD4',
} as const satisfies Partial<ThemeColors>;
