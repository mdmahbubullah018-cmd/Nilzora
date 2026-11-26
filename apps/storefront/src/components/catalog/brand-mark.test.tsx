import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandMark, brandInitials } from './brand-mark';

/*
 * A brand logo is never cropped or stretched, and never left broken: the mark either shows the
 * logo whole (contained) or the brand's initials, on both the banner shape and the square tile.
 */

const LOGO = {
  url: 'https://media.example.test/b/full.webp',
  thumbUrl: 'https://media.example.test/b/thumb.webp',
};

describe('brandInitials', () => {
  it('takes the first letter of the first two words, or the first two letters', () => {
    expect(brandInitials('Aarong')).toBe('AA');
    expect(brandInitials('Cotton Craft')).toBe('CC');
    expect(brandInitials('  Deshi   Threads ')).toBe('DT');
    expect(brandInitials('')).toBe('');
  });
});

describe('BrandMark', () => {
  it('shows the logo whole inside a square tile', () => {
    render(<BrandMark brand={{ name: 'Aarong', logo: LOGO }} />);

    const image = screen.getByRole<HTMLImageElement>('presentation', { hidden: true });
    expect(image.src).toBe(LOGO.thumbUrl);
    // Containment, never a cover crop: a wide or tall logo keeps its own proportions.
    expect(image.className).toContain('object-contain');
    expect(image.className).not.toContain('object-cover');
    // The tile is the branded square behind it.
    expect(image.parentElement?.className).toContain('size-20');
  });

  it('shows the logo whole in a banner band, at the height the list gives it', () => {
    render(<BrandMark brand={{ name: 'Aarong', logo: LOGO }} shape="band" className="h-20" />);

    const image = screen.getByRole<HTMLImageElement>('presentation', { hidden: true });
    expect(image.className).toContain('object-contain');
    expect(image.className).not.toContain('object-cover');
    expect(image.parentElement?.className).toContain('h-20');
    expect(image.parentElement?.className).toContain('w-full');
  });

  it('shows the initials when the brand has no logo', () => {
    render(<BrandMark brand={{ name: 'Deshi Threads', logo: null }} />);

    expect(screen.getByText('DT')).toBeTruthy();
  });

  it('falls back to the initials when the logo cannot be loaded', () => {
    render(<BrandMark brand={{ name: 'Aarong', logo: LOGO }} />);

    fireEvent.error(screen.getByRole('presentation', { hidden: true }));

    expect(screen.getByText('AA')).toBeTruthy();
  });
});
