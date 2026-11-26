// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProductShare } from './product-share';

const PRODUCT = {
  slug: 'clay-mug',
  name: 'Clay Mug',
  summary: 'Hand-thrown in Dhaka.',
  status: 'active' as const,
  image: { url: 'https://media.nilzora.test/products/clay-mug/full.webp' },
};

beforeEach(() => {
  process.env.STOREFRONT_URL = 'https://nilzora.com.bd';
});

afterEach(() => {
  cleanup();
  delete process.env.STOREFRONT_URL;
});

describe('ProductShare', () => {
  it('offers a working share for a product that is on sale', () => {
    render(<ProductShare product={PRODUCT} />);

    const button = screen.getByRole('button', { name: 'Share Clay Mug' });
    expect(button.getAttribute('title')).toBe('Share a link to Clay Mug');
    expect(button.getAttribute('aria-disabled')).toBeNull();
  });

  it('explains a draft instead of offering a link that would not exist', () => {
    render(<ProductShare product={{ ...PRODUCT, status: 'draft' }} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen.getByText(/This product is not on sale, so it has no public page to share yet\./),
    ).toBeTruthy();
  });

  it('explains an archived product', () => {
    render(<ProductShare product={{ ...PRODUCT, status: 'archived' }} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/archived and no longer appears on the storefront/)).toBeTruthy();
  });

  it('shows nothing at all in a list row that cannot be shared', () => {
    const { container } = render(
      <ProductShare product={{ ...PRODUCT, status: 'draft' }} variant="icon" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('stays silent rather than sharing a guessed address when no storefront is configured', () => {
    delete process.env.STOREFRONT_URL;
    const original = process.env.NODE_ENV;
    try {
      Object.assign(process.env, { NODE_ENV: 'production' });
      render(<ProductShare product={PRODUCT} />);

      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.getByText(/Set STOREFRONT_URL/)).toBeTruthy();
    } finally {
      Object.assign(process.env, { NODE_ENV: original });
    }
  });
});
