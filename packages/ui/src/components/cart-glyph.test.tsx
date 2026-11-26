import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CartGlyph, CartIcon } from './cart-glyph';

/** The tray path that identifies the Nilzora cart, as opposed to any other shopping icon. */
const TRAY = 'M6.4 6.75h14.5';

describe('CartGlyph', () => {
  it('draws the tray, the handle and two wheels', () => {
    const { container } = render(<CartGlyph />);
    const svg = container.querySelector('svg');

    expect(svg?.querySelectorAll('path')).toHaveLength(2);
    const paths = [...(svg?.querySelectorAll('path') ?? [])].map(
      (path) => path.getAttribute('d') ?? '',
    );
    expect(paths.some((d) => d.includes(TRAY))).toBe(true);
    expect(svg?.querySelectorAll('circle')).toHaveLength(2);
  });

  it('takes the surrounding text colour unless told otherwise', () => {
    const { container, rerender } = render(<CartGlyph className="text-primary" />);

    expect(container.querySelector('svg')?.getAttribute('stroke')).toBe('currentColor');
    rerender(<CartGlyph color="#0F172A" />);
    expect(container.querySelector('svg')?.getAttribute('stroke')).toBe('#0F172A');
  });

  it('is decorative unless it is given a name', () => {
    const { container, rerender } = render(<CartGlyph />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');

    rerender(<CartGlyph title="Cart" />);
    const named = container.querySelector('svg');
    expect(named?.getAttribute('role')).toBe('img');
    expect(named?.querySelector('title')?.textContent).toBe('Cart');
  });

  it('keeps the size and stroke a caller asks for', () => {
    const { container } = render(<CartGlyph size={40} strokeWidth={1.6} />);
    const svg = container.querySelector('svg');

    expect(svg?.getAttribute('width')).toBe('40');
    expect(svg?.getAttribute('height')).toBe('40');
    expect(svg?.getAttribute('stroke-width')).toBe('1.6');
  });
});

describe('CartIcon', () => {
  it('renders the same drawing for the components that take a Lucide icon', () => {
    const Icon = CartIcon;
    const { container } = render(<Icon size={18} color="#0284C7" />);
    const svg = container.querySelector('svg');

    expect(svg?.getAttribute('width')).toBe('18');
    expect(svg?.getAttribute('stroke')).toBe('#0284C7');
    const paths = [...(svg?.querySelectorAll('path') ?? [])].map(
      (path) => path.getAttribute('d') ?? '',
    );
    expect(paths.some((d) => d.includes(TRAY))).toBe(true);
  });
});
