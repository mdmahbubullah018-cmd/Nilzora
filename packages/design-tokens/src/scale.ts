/** Corner radii in px, shared by the web theme (tokens.css) and the native theme. */
export const radii = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const;

/** 4px spacing scale used by the native theme (Tailwind provides the same scale on the web). */
export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

/**
 * Typefaces. Poppins SemiBold is the brand wordmark face and is used for display
 * headings; Inter is the interface and body face. Neither covers Bengali script,
 * so Bengali text falls through to Noto Sans Bengali on the web. The native app
 * uses the platform system fonts, which include Bengali coverage on Android.
 */
export const fontFamilies = {
  display: 'Poppins',
  sans: 'Inter',
  bengali: 'Noto Sans Bengali',
} as const;

export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;
