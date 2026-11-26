import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProductCard } from './product-card';
import { SoldCount, soldCountLabel } from './sold-count';
import { summary } from '@/testing/catalog-fixtures';

describe('soldCountLabel', () => {
  it('says nothing until something has really sold', () => {
    expect(soldCountLabel(undefined)).toBeNull();
    expect(soldCountLabel(0)).toBeNull();
    expect(soldCountLabel(-3)).toBeNull();
    expect(soldCountLabel(Number.NaN)).toBeNull();
  });

  it('shows the figure, abbreviating only large ones', () => {
    expect(soldCountLabel(1)).toBe('1 sold');
    expect(soldCountLabel(120)).toBe('120 sold');
    expect(soldCountLabel(999)).toBe('999 sold');
    expect(soldCountLabel(1200)).toBe('1.2k sold');
  });
});

describe('sold count on a product card', () => {
  it('appears for a product with sales and is absent without them', () => {
    const { unmount } = render(<SoldCount count={120} />);
    expect(screen.getByText('120 sold')).not.toBeNull();
    unmount();

    render(<ProductCard product={summary({ name: 'Plain mug' })} />);
    expect(screen.queryByText(/sold$/)).toBeNull();
  });

  it('is shown on the card beside the product information', () => {
    render(<ProductCard product={summary({ name: 'Popular mug', soldCount: 45 })} />);
    expect(screen.getByText('45 sold')).not.toBeNull();
  });
});
