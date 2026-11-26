import type { TextStyle } from 'react-native';
import {
  colors,
  fontFamilies,
  fontWeights,
  lightTheme,
  radii as sharedRadii,
  spacing,
} from '@nilzora/design-tokens';

/**
 * Typography presets. They carry size, line height, weight and tracking only — never a
 * font family — so today's build keeps the platform system fonts (which cover Bengali)
 * and a bundled Poppins/Inter face can later be applied in one place (`fontFamilies`)
 * without touching a single screen.
 */
const text = {
  display: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: fontWeights.semibold,
    letterSpacing: -0.7,
  },
  title: { fontSize: 22, lineHeight: 28, fontWeight: fontWeights.semibold, letterSpacing: -0.5 },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: fontWeights.semibold, letterSpacing: -0.2 },
  subheading: { fontSize: 16, lineHeight: 22, fontWeight: fontWeights.semibold, letterSpacing: 0 },
  body: { fontSize: 14, lineHeight: 20, fontWeight: fontWeights.regular, letterSpacing: 0 },
  bodyStrong: { fontSize: 14, lineHeight: 20, fontWeight: fontWeights.semibold, letterSpacing: 0 },
  /** Intro and subtitle copy: one step larger than body, for the auth screens. */
  lead: { fontSize: 15, lineHeight: 22, fontWeight: fontWeights.regular, letterSpacing: 0 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: fontWeights.medium, letterSpacing: 0 },
  micro: { fontSize: 11, lineHeight: 15, fontWeight: fontWeights.medium, letterSpacing: 0.2 },
} satisfies Record<string, TextStyle>;

/**
 * Native theme built from the shared Nilzora design tokens. Semantic roles come
 * from the shared light theme (WCAG-checked in @nilzora/design-tokens); the few
 * native-only roles below are checked in src/__tests__/theme-contrast.test.ts.
 *
 * Typography uses the platform system fonts, so no font files are bundled.
 */
export const theme = {
  colors: {
    ...colors,
    ...lightTheme,
    /** Tinted status pill. */
    infoSurface: '#E0F2FE',
    infoForeground: '#075985',
    /** Soft tile behind decorative icons. */
    iconSurface: '#F0F9FF',
    /**
     * The pale blue field behind the account and sign-in headers: the light counterpart of the
     * navy panels those screens used to open with. `accentBorder` is its hairline edge, and
     * `accentSurfaceDeep` the second, slightly stronger layer inside it.
     */
    accentSurface: '#EFF8FF',
    accentSurfaceDeep: '#E0F2FE',
    accentBorder: '#BAE6FD',
    /** Field error text and border; AA on white (6.5:1) and on the page background (5.9:1). */
    fieldError: '#B91C1C',
  },
  /** Inline notices, matching the web Alert tones. */
  notice: {
    info: { surface: '#F0F9FF', border: '#BAE6FD', foreground: '#0C4A6E', icon: colors.primary },
    success: { surface: '#F0FDF4', border: '#BBF7D0', foreground: '#14532D', icon: '#16A34A' },
    warning: { surface: '#FFFBEB', border: '#FDE68A', foreground: '#78350F', icon: '#D97706' },
    danger: { surface: '#FEF2F2', border: '#FECACA', foreground: '#7F1D1D', icon: '#DC2626' },
  },
  /** Minimum touch target (Android Material guidance: 48dp). */
  touchTarget: 48,

  /**
   * The Nilzora palette as named roles. Screens never write a hex value; they read these.
   * Keeping the raw values here (and nowhere else) is what makes a future palette change a
   * one-file edit.
   */
  brand: {
    navy: '#0F172A',
    slate: '#334155',
    muted: '#CBD5E1',
    soft: '#F1F5F9',
    sky: '#38BDF8',
    primary: '#0284C7',
    primaryPressed: '#0369A1',
    violet: '#8B5CF6',
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#EF4444',
    offer: '#F43F5E',
    /**
     * The launch surface: the native splash (android colors.xml `splashscreen_background`,
     * app.json) and the animated splash drawn over the app must share this one value, or the
     * hand-over between them flashes.
     */
    splashBackground: '#F1F5FB',
    /** Text/icons sitting on a solid brand fill. */
    onSolid: '#FFFFFF',
  },

  /**
   * "Liquid glass" means white at ~65% over content. Android has no cheap backdrop blur, so
   * the translucent surface below is the real implementation; a BlurView can be layered on
   * top later without changing any caller.
   */
  glass: {
    surface: 'rgba(255, 255, 255, 0.65)',
    /** A second, lighter level for sheets that sit above another glass surface. */
    surfaceRaised: 'rgba(255, 255, 255, 0.82)',
    border: 'rgba(255, 255, 255, 0.65)',
    /** Text on a glass surface: full strength, because glass is light here. */
    foreground: '#0F172A',
    mutedForeground: '#334155',
    /** The soft pill behind the active tab. */
    activePill: 'rgba(2, 132, 199, 0.12)',
    /** The floating tab bar: a touch lighter than a sheet, so the page shows through it. */
    tabBar: 'rgba(255, 255, 255, 0.74)',
  },

  /** Only hero banners and promo cards use a gradient. */
  gradients: {
    skyToViolet: ['#38BDF8', '#8B5CF6'] as const,
    navyToPrimary: ['#0F172A', '#0284C7'] as const,
  },

  /** Soft tinted surfaces for status pills, kept here so components stay hex-free. */
  pill: {
    successSurface: 'rgba(34, 197, 94, 0.14)',
    warningSurface: 'rgba(245, 158, 11, 0.16)',
  },

  /** Android elevation presets, so cards share one shadow language. */
  elevation: {
    none: 0,
    card: 2,
    floating: 12,
  },

  /**
   * Shadow presets paired with the elevation above. Android reads `elevation`; the iOS
   * shadow fields are ignored there, so both are declared together and used as one spread.
   */
  shadow: {
    none: {
      shadowColor: 'transparent',
      shadowOpacity: 0,
      shadowRadius: 0,
      shadowOffset: { width: 0, height: 0 },
      elevation: 0,
    },
    card: {
      shadowColor: colors.navy,
      shadowOpacity: 0.06,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 2,
    },
    floating: {
      shadowColor: colors.navy,
      shadowOpacity: 0.16,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 10 },
      elevation: 12,
    },
    sheet: {
      shadowColor: colors.navy,
      shadowOpacity: 0.12,
      shadowRadius: 28,
      shadowOffset: { width: 0, height: -6 },
      elevation: 16,
    },
  },

  /** Type scale. Body copy sits at 14, per the product-page guidance. */
  type: {
    display: 30,
    title: 22,
    heading: 18,
    subheading: 16,
    body: 14,
    caption: 12,
    micro: 11,
  },

  /** Ready-made text styles: spread one into a Text style instead of repeating numbers. */
  text,

  /**
   * Brand typefaces, declared for the future bundled face. Nothing applies them yet: the
   * system font is used until Poppins/Inter files ship with the app.
   */
  fontFamilies,

  /** One stroke language for every icon, whatever screen it sits on. */
  icon: {
    /** `xs` is the compact-size glyph for slim inline chips such as the trust strip. */
    size: { xs: 14, sm: 16, md: 20, lg: 24, xl: 28 },
    stroke: { idle: 1.9, active: 2.3 },
  },

  /**
   * Corner radii. The shared scale is kept; the named roles below are what cards, inputs,
   * sheets and hero surfaces use, so corner shapes stay consistent as screens are redesigned.
   */
  radii: {
    ...sharedRadii,
    input: 14,
    card: 20,
    hero: 24,
    sheet: 28,
  },
  /** 4px base scale; every 8pt step (8/16/24/32/40/48/64) exists within it. */
  spacing,

  /**
   * The vertical rhythm of a page, in named roles. Screens read these instead of picking a
   * step of the scale, so every page steps at the same distance: a section is one gap away
   * from the next, a heading one short step from its content.
   */
  layout: {
    /** Space above a tab screen's content, under the safe area. */
    screenTop: spacing[4],
    /** Between a page frame's blocks: the header row, the title, the page body. */
    frameGap: spacing[5],
    /** Between two sections of a page. */
    sectionGap: spacing[5],
    /** Between a section's heading and the content under it. */
    sectionHeaderGap: spacing[3],
    /** Between the items of a page body, and between the cards of a grid. */
    itemGap: spacing[4],
  },
  fontWeights,
} as const;

export type Theme = typeof theme;
export type NoticeTone = keyof typeof theme.notice;
