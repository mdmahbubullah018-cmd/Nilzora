import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert, type AlertTone } from './alert';
import { Badge, type BadgeTone } from './badge';
import { Button, buttonClasses } from './button';
import { Input } from './input';
import { Logo } from './logo';

/*
 * The colour values behind these roles are checked for WCAG AA in
 * @nilzora/design-tokens (themes.test.ts), and their Tailwind mappings in
 * styles.test.ts. These tests make sure the components keep using those verified
 * roles instead of lower-contrast brand colours.
 */

function classesOf(element: HTMLElement): string[] {
  return element.className.split(/\s+/);
}

describe('accessible colour roles', () => {
  it('fills primary buttons with the AA primary action colour, not the brand primary', () => {
    render(<Button>Place order</Button>);
    const classes = classesOf(screen.getByRole('button', { name: 'Place order' }));

    expect(classes).toEqual(
      expect.arrayContaining([
        'bg-primary-action',
        'text-primary-action-foreground',
        'hover:bg-primary-action-hover',
      ]),
    );
    expect(classes).not.toContain('bg-primary');
  });

  it('fills danger buttons with the AA danger action colour', () => {
    const classes = buttonClasses({ variant: 'danger' }).split(' ');

    expect(classes).toEqual(
      expect.arrayContaining([
        'bg-danger-action',
        'text-danger-action-foreground',
        'hover:bg-danger-action-hover',
      ]),
    );
  });

  it('renders offer badges on the AA offer colour, not the brand offer colour', () => {
    render(<Badge tone="offer">−20%</Badge>);
    const classes = classesOf(screen.getByText('−20%'));

    expect(classes).toEqual(
      expect.arrayContaining(['bg-offer-badge', 'text-offer-badge-foreground']),
    );
    expect(classes).not.toContain('bg-offer');
  });

  it('gives form controls a 3:1 border and a fully opaque focus outline', () => {
    render(<Input aria-label="Email" />);
    const classes = classesOf(screen.getByRole('textbox', { name: 'Email' }));

    expect(classes).toContain('border-input-border');
    expect(classes).toContain('focus-visible:outline-ring');
    expect(classes.some((name) => /outline-ring\/\d+/.test(name))).toBe(false);
  });

  it('shows keyboard focus on buttons with the verified ring colour', () => {
    expect(buttonClasses().split(' ')).toContain('focus-visible:outline-ring');
  });
});

/*
 * Tinted tones use Tailwind's fixed palette, which the dark theme cannot remap, so each
 * one needs its own dark: background and text. Without them a light tint would glare
 * from the navy page (or a 700-shade label would vanish into it).
 */
describe('dark theme variants', () => {
  const tintedBadges: BadgeTone[] = [
    'neutral',
    'primary',
    'success',
    'warning',
    'danger',
    'violet',
    'moderator',
  ];

  it.each(tintedBadges)('gives the %s badge a dark background and a light label', (tone) => {
    render(<Badge tone={tone}>Label</Badge>);
    const classes = classesOf(screen.getByText('Label'));

    expect(classes.some((name) => name.startsWith('dark:bg-'))).toBe(true);
    expect(classes.some((name) => /^dark:text-\w+-200$/.test(name))).toBe(true);
  });

  it('keeps the solid offer badge on its verified colours in both themes', () => {
    render(<Badge tone="offer">−20%</Badge>);
    const classes = classesOf(screen.getByText('−20%'));
    expect(classes.some((name) => name.startsWith('dark:'))).toBe(false);
  });

  it.each(['info', 'success', 'warning', 'danger'] satisfies AlertTone[])(
    'gives the %s alert a dark tint and light text',
    (tone) => {
      render(<Alert tone={tone} title="Notice" />);
      const alert = screen.getByText('Notice').closest('[role]');
      if (!(alert instanceof HTMLElement)) throw new Error('alert not rendered');
      const classes = classesOf(alert);

      expect(classes.some((name) => name.startsWith('dark:bg-'))).toBe(true);
      expect(classes.some((name) => /^dark:text-\w+-100$/.test(name))).toBe(true);
    },
  );

  it('switches the light logo to the on-navy artwork under the dark theme', () => {
    const { container } = render(<Logo />);
    const logo = screen.getByRole('img', { name: 'Nilzora' });

    // The artwork itself carries the brand colours, so the colour check moves to the stylesheet:
    // styles.test.ts reads the rule that swaps the picture under [data-theme='dark'].
    expect(logo.getAttribute('data-tone')).toBeNull();
    expect(container.querySelectorAll('.nz-brand-logo')).toHaveLength(1);
  });
});
