import { render, screen } from '@testing-library/react';
import { Package, Shirt } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Price, savingPercent } from './price';
import { categoryIcon, ProductVisual } from './product-visual';

describe('Price', () => {
  it('shows the selling price from poisha', () => {
    render(<Price priceMinor={125_000} />);
    expect(screen.getByText('৳1,250')).not.toBeNull();
    expect(screen.queryByText(/Was/)).toBeNull();
  });

  it('strikes through a higher former price and can show the saving', () => {
    const { container } = render(
      <Price priceMinor={65_000} compareAtPriceMinor={79_000} showSaving />,
    );
    expect(container.querySelector('.line-through')?.textContent).toBe('Was ৳790');
    expect(screen.getByText('Save 17%')).not.toBeNull();
  });

  it('ignores a former price that is not higher', () => {
    render(<Price priceMinor={65_000} compareAtPriceMinor={65_000} showSaving />);
    expect(screen.queryByText(/Save/)).toBeNull();
  });

  it('computes whole-percent savings', () => {
    expect(savingPercent(65_000, 79_000)).toBe(17);
    expect(savingPercent(100, null)).toBeNull();
    expect(savingPercent(9_999, 10_000)).toBeNull();
  });
});

describe('ProductVisual', () => {
  it('uses the category icon, or a neutral one for anything unknown', () => {
    expect(categoryIcon('fashion')).toBe(Shirt);
    expect(categoryIcon('constructor')).toBe(Package);
    expect(categoryIcon(undefined)).toBe(Package);
  });

  it('is decorative', () => {
    const { container } = render(<ProductVisual categorySlug="groceries" />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });
});
