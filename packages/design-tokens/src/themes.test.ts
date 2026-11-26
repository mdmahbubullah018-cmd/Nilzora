import { describe, expect, it } from 'vitest';
import { colors } from './colors';
import { AA, contrastRatio } from './contrast';
import { darkTheme as d, lightTheme as t, moderatorWorkspace as moderator } from './themes';

/** [label, foreground, background] */
type Pair = [string, string, string];

const textPairs: Pair[] = [
  ['heading on page', t.foreground, t.background],
  ['heading on soft background', t.foreground, t.surfaceMuted],
  ['body on page', t.body, t.background],
  ['body on soft background', t.body, t.surfaceMuted],
  ['muted text on page', t.mutedForeground, t.background],
  ['muted text on soft background', t.mutedForeground, t.surfaceMuted],
  ['link on page', t.link, t.background],
  ['link on soft background', t.link, t.surfaceMuted],
  ['primary button', t.primaryActionForeground, t.primaryAction],
  ['primary button (hover)', t.primaryActionForeground, t.primaryActionHover],
  ['danger button', t.dangerActionForeground, t.dangerAction],
  ['danger button (hover)', t.dangerActionForeground, t.dangerActionHover],
  ['offer badge', t.offerBadgeForeground, t.offerBadge],
  ['secondary button (hover)', t.foreground, t.border],
  ['sidebar text', t.sidebarForeground, t.sidebar],
  ['sidebar secondary text', t.sidebarMuted, t.sidebar],
  ['sidebar accent text', t.workspaceAccentText, t.sidebar],
  ['moderator sidebar text', t.sidebarForeground, moderator.sidebar],
  ['moderator sidebar secondary text', t.sidebarMuted, moderator.sidebar],
  ['moderator accent text', moderator.workspaceAccentText, moderator.sidebar],
];

const nonTextPairs: Pair[] = [
  ['focus ring on page', t.ring, t.background],
  ['focus ring on soft background', t.ring, t.surfaceMuted],
  ['focus ring on admin sidebar', t.ringOnDark, t.sidebar],
  ['focus ring on moderator sidebar', t.ringOnDark, moderator.sidebar],
  ['input border on page', t.inputBorder, t.background],
  ['input border on soft background', t.inputBorder, t.surfaceMuted],
];

describe('WCAG AA text contrast (4.5:1)', () => {
  it.each(textPairs)('%s', (_, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA.text);
  });
});

describe('WCAG AA non-text contrast (3:1)', () => {
  it.each(nonTextPairs)('%s', (_, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA.largeTextOrUi);
  });
});

describe('brand fidelity', () => {
  it('keeps the canonical brand primary for accents', () => {
    expect(t.primary).toBe(colors.primary);
    expect(colors.primary).toBe('#0284C7');
  });

  it('derives action colours from the brand palette where it is accessible', () => {
    expect(t.primaryAction).toBe(colors.primaryHover);
    expect(t.link).toBe(colors.primaryHover);
  });
});

/** The dark theme's pairings; cards (surface) and the page well (surfaceMuted) both carry text. */
const darkText: Pair[] = [
  ['heading on page', d.foreground, d.background],
  ['heading on card', d.foreground, d.surface],
  ['heading on well', d.foreground, d.surfaceMuted],
  ['body on card', d.body, d.surface],
  ['muted text on page', d.mutedForeground, d.background],
  ['muted text on card', d.mutedForeground, d.surface],
  ['muted text on well', d.mutedForeground, d.surfaceMuted],
  ['link on card', d.link, d.surface],
  ['link on page', d.link, d.background],
  ['primary button', d.primaryActionForeground, d.primaryAction],
  ['primary button (hover)', d.primaryActionForeground, d.primaryActionHover],
  ['danger button', d.dangerActionForeground, d.dangerAction],
  ['offer badge', d.offerBadgeForeground, d.offerBadge],
  ['secondary button (hover)', d.foreground, d.border],
  ['sidebar text', d.sidebarForeground, d.sidebar],
  ['sidebar secondary text', d.sidebarMuted, d.sidebar],
  ['sidebar accent text', d.workspaceAccentText, d.sidebar],
];

const darkNonText: Pair[] = [
  ['focus ring on page', d.ring, d.background],
  ['focus ring on card', d.ring, d.surface],
  ['focus ring on sidebar', d.ringOnDark, d.sidebar],
  ['input border on card', d.inputBorder, d.surface],
  ['input border on page', d.inputBorder, d.background],
];

describe('dark theme: WCAG AA text contrast (4.5:1)', () => {
  it.each(darkText)('%s', (_, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA.text);
  });
});

describe('dark theme: WCAG AA non-text contrast (3:1)', () => {
  it.each(darkNonText)('%s', (_, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA.largeTextOrUi);
  });
});
