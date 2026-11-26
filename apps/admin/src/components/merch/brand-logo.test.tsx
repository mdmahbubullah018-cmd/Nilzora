// @vitest-environment jsdom
import type { AdminBrand } from '@nilzora/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BrandLogo, brandInitials } from './brand-logo';

/*
 * The brand logo tile on the admin brands page.
 *
 * A logo is served by the media service, so it can fail for reasons the page cannot see. The
 * tile must then show the brand's initials instead of a broken picture — and it must forget an
 * earlier failure when the brand's logo changes, otherwise a logo fixed in admin would never
 * appear.
 */

function brand(overrides: Partial<AdminBrand> = {}): AdminBrand {
  return {
    id: '0d000000-0000-4000-8000-000000000001',
    slug: 'north-star',
    name: 'North Star',
    description: null,
    logo: {
      url: 'https://media.nilzora.test/brands/north-star/full.webp',
      thumbUrl: 'https://media.nilzora.test/brands/north-star/thumb.webp',
    },
    banner: null,
    productCount: 0,
    isActive: true,
    ...overrides,
  };
}

afterEach(cleanup);

describe('brandInitials', () => {
  it('takes the first letter of the first two words', () => {
    expect(brandInitials('North Star')).toBe('NS');
  });

  it('takes two letters of a single-word name', () => {
    expect(brandInitials('Aarong')).toBe('AA');
  });
});

describe('the admin brand logo', () => {
  it('shows the uploaded logo', () => {
    render(<BrandLogo brand={brand()} />);

    const picture = screen.getByRole('presentation', { hidden: true });
    expect(picture.getAttribute('src')).toBe('https://media.nilzora.test/brands/north-star/thumb.webp');
  });

  it('shows the initials when the brand has no logo', () => {
    render(<BrandLogo brand={brand({ logo: null })} />);

    expect(screen.queryByRole('presentation', { hidden: true })).toBeNull();
    expect(screen.getByText('NS')).toBeTruthy();
  });

  it('falls back to the initials when the logo cannot be loaded', () => {
    render(<BrandLogo brand={brand()} />);

    fireEvent.error(screen.getByRole('presentation', { hidden: true }));

    expect(screen.queryByRole('presentation', { hidden: true })).toBeNull();
    expect(screen.getByText('NS')).toBeTruthy();
  });

  it('tries the new picture after the logo changes', () => {
    const { rerender } = render(<BrandLogo brand={brand()} />);
    fireEvent.error(screen.getByRole('presentation', { hidden: true }));
    expect(screen.getByText('NS')).toBeTruthy();

    rerender(
      <BrandLogo
        brand={brand({
          logo: {
            url: 'https://media.nilzora.test/brands/north-star-v2/full.webp',
            thumbUrl: 'https://media.nilzora.test/brands/north-star-v2/thumb.webp',
          },
        })}
      />,
    );

    expect(screen.getByRole('presentation', { hidden: true }).getAttribute('src')).toBe(
      'https://media.nilzora.test/brands/north-star-v2/thumb.webp',
    );
  });

  it('keeps the initials when another record has the same broken logo', () => {
    const { rerender } = render(<BrandLogo brand={brand()} />);
    fireEvent.error(screen.getByRole('presentation', { hidden: true }));

    rerender(<BrandLogo brand={brand({ name: 'North Star Kids' })} />);

    expect(screen.getByText('NS')).toBeTruthy();
  });
});
