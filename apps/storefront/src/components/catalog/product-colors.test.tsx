import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProductSummary } from '@nilzora/contracts';
import { ProductCard } from './product-card';
import { ProductColors } from './product-colors';
import { summary } from '@/testing/catalog-fixtures';

const black = { valueSlug: 'black', value: 'Black', swatchHex: '#0F172A' };
const navy = { valueSlug: 'navy', value: 'Navy', swatchHex: '#1E3A8A' };
const white = { valueSlug: 'white', value: 'White', swatchHex: '#F1F5F9' };

/** The discs are decorative spans inside one labelled paragraph. */
function swatches(container: HTMLElement): HTMLSpanElement[] {
  return [...container.querySelectorAll('p[aria-label] > span')] as HTMLSpanElement[];
}

describe('product colour preview', () => {
  it('draws nothing for a product sold in one colour or none', () => {
    const one = render(<ProductColors colors={[black]} />);
    expect(one.container.querySelector('p[aria-label]')).toBeNull();
    one.unmount();

    const none = render(<ProductColors colors={undefined} />);
    expect(none.container.querySelector('p[aria-label]')).toBeNull();
    none.unmount();

    const empty = render(<ProductColors colors={[]} />);
    expect(empty.container.querySelector('p[aria-label]')).toBeNull();
  });

  it('draws a disc per colour, in the API order, with its configured swatch', () => {
    const { container } = render(<ProductColors colors={[black, navy, white]} />);
    const discs = swatches(container);
    expect(discs.map((disc) => disc.style.backgroundColor)).toEqual([
      'rgb(15, 23, 42)',
      'rgb(30, 58, 138)',
      'rgb(241, 245, 249)',
    ]);
    expect(screen.getByLabelText('Available in 3 colours: Black, Navy, White')).not.toBeNull();
  });

  it('is a 16px disc with one solid edge, so it stays sharp on any screen', () => {
    const { container } = render(<ProductColors colors={[black, navy]} />);
    const disc = swatches(container)[0];
    // Tailwind `size-4` is 16px; the classes carry the size, the edge and nothing fuzzy.
    expect(disc?.className).toContain('size-4');
    expect(disc?.className).toContain('rounded-full');
    expect(disc?.className).toContain('border-border-strong');
    // No opacity, shadow or scale: those are what made the old dots look soft.
    expect(disc?.className).not.toMatch(/opacity|shadow|scale|blur/);
    expect(disc?.className).not.toContain('size-3');
  });

  it('summarises the colours past the fourth as a count', () => {
    const many = [
      black,
      navy,
      white,
      { valueSlug: 'grey', value: 'Grey', swatchHex: '#94A3B8' },
      { valueSlug: 'red', value: 'Red', swatchHex: '#EF4444' },
    ];
    const { container } = render(<ProductColors colors={many} />);
    // Four discs plus the "+1", and the label still names every colour.
    expect(swatches(container)).toHaveLength(5);
    expect(screen.getByText('+1')).not.toBeNull();
    expect(screen.getByLabelText(/Available in 5 colours: .*Red$/)).not.toBeNull();
  });

  it('is a preview, not a control: nothing inside it is focusable or clickable', () => {
    const { container } = render(<ProductColors colors={[black, navy]} />);
    const preview = container.querySelector('p[aria-label]');
    expect(preview?.querySelectorAll('a, button, input, [tabindex], [role="button"]').length).toBe(
      0,
    );
  });

  it('appears on the card, so a listing shows the choice without opening the product', () => {
    const product: ProductSummary = summary({ name: 'Everyday tee', colors: [black, navy] });
    render(<ProductCard product={product} />);
    expect(screen.getByLabelText('Available in 2 colours: Black, Navy')).not.toBeNull();
  });
});
