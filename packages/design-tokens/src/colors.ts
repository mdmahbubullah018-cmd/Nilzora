/**
 * The approved Nilzora brand palette. These values are fixed by the brand
 * guidelines; change them only with explicit approval.
 */
export const colors = {
  navy: '#0F172A',
  slate: '#334155',
  mutedSlate: '#CBD5E1',
  softBackground: '#F1F5F9',
  sky: '#38BDF8',
  primary: '#0284C7',
  primaryHover: '#0369A1',
  violet: '#8B5CF6',
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  offer: '#F43F5E',
  moderator: '#14B8A6',
} as const;

export type BrandColor = keyof typeof colors;
