import { AA, contrastRatio } from '@nilzora/design-tokens';
import { theme } from '../theme';

const c = theme.colors;

/** [label, text colour, background] for text rendered by the native screens. */
const textPairs: [string, string, string][] = [
  ['active tab label', c.link, c.surface],
  ['inactive tab label', c.mutedForeground, c.surface],
  ['screen title on screen background', c.foreground, c.surfaceMuted],
  ['card title', c.foreground, c.surface],
  ['card secondary text', c.mutedForeground, c.surface],
  ['status pill', c.infoForeground, c.infoSurface],
  ['hero heading', c.softBackground, c.navy],
  ['hero body', c.mutedSlate, c.navy],
  ['hero note', c.sky, c.navy],
  ['primary button', c.primaryActionForeground, c.primaryAction],
  ['primary button (pressed)', c.primaryActionForeground, c.primaryActionHover],
  ['secondary button', c.foreground, c.surface],
  ['secondary button (pressed)', c.foreground, c.border],
  ['danger button', c.dangerAction, c.surface],
  ['danger button (pressed)', c.dangerActionHover, theme.notice.danger.surface],
  ['field label', c.foreground, c.surface],
  ['field error', c.fieldError, c.surface],
  ['field error on the page background', c.fieldError, c.surfaceMuted],
  ['field placeholder and hint', c.mutedForeground, c.surface],
  // The pale blue headers on the account and sign-in screens.
  ['account header name', c.foreground, c.accentSurface],
  ['account header detail', c.body, c.accentSurface],
  ['account header note', c.mutedForeground, c.accentSurface],
  ['account header action', c.link, c.surface],
  ['sign-in heading', c.foreground, c.accentSurface],
  ['sign-in subtitle', c.body, c.accentSurface],
  ['sign-in eyebrow', c.link, c.accentSurface],
  ['cart badge', c.offerBadgeForeground, c.offerBadge],
  ...Object.entries(theme.notice).map(([tone, n]): [string, string, string] => [
    `${tone} notice`,
    n.foreground,
    n.surface,
  ]),
];

/** [label, colour, background] for borders and icons that convey state (3:1). */
const uiPairs: [string, string, string][] = [
  ['input border', c.inputBorder, c.surface],
  ['input error border', c.fieldError, c.surface],
  ['input error border on the page background', c.fieldError, c.surfaceMuted],
  ['cart badge surface against a card', c.offerBadge, c.surface],
  ['secondary button border', c.inputBorder, c.surface],
  ...Object.entries(theme.notice).map(([tone, n]): [string, string, string] => [
    `${tone} notice icon`,
    n.icon,
    n.surface,
  ]),
];

describe('native theme contrast (WCAG AA, 4.5:1)', () => {
  it.each(textPairs)('%s', (_, text, background) => {
    expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(AA.text);
  });
});

describe('native UI contrast (WCAG AA non-text, 3:1)', () => {
  it.each(uiPairs)('%s', (_, colour, background) => {
    expect(contrastRatio(colour, background)).toBeGreaterThanOrEqual(AA.largeTextOrUi);
  });
});
