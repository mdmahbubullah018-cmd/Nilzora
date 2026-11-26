import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrandLink, CategoryNode } from '@/lib/navigation';
import { DesktopNav } from './desktop-nav';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const node = (slug: string, name: string, children: CategoryNode[] = []): CategoryNode => ({
  slug,
  name,
  href: `/categories/${slug}` as CategoryNode['href'],
  children,
});
const TREE = [
  node('alpha', 'Alpha', [node('alpha-one', 'Alpha one'), node('alpha-two', 'Alpha two')]),
  node('beta', 'Beta', [node('beta-one', 'Beta one')]),
  node('gamma', 'Gamma'),
];
const BRANDS: BrandLink[] = [
  { slug: 'acme', name: 'Acme', href: '/brands/acme' as BrandLink['href'] },
];

const mouse = { pointerType: 'mouse' } as const;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('DesktopNav dropdowns', () => {
  it('shows only the top-level categories first, then the hovered category’s subcategories', () => {
    render(<DesktopNav categories={TREE} brands={BRANDS} />);
    const trigger = screen.getByRole('button', { name: 'Category' });

    fireEvent.pointerEnter(trigger.closest('li') as HTMLElement, mouse);

    expect(screen.getByRole('link', { name: 'Alpha' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Beta' })).toBeTruthy();
    // Nothing underneath is revealed on the first hover.
    expect(screen.queryByRole('link', { name: 'Alpha one' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Beta one' })).toBeNull();

    fireEvent.pointerEnter(
      screen.getByRole('link', { name: 'Alpha' }).closest('li') as HTMLElement,
      mouse,
    );
    expect(screen.getByRole('link', { name: 'Alpha one' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Beta one' })).toBeNull();

    fireEvent.pointerEnter(
      screen.getByRole('link', { name: 'Beta' }).closest('li') as HTMLElement,
      mouse,
    );
    expect(screen.getByRole('link', { name: 'Beta one' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Alpha one' })).toBeNull();
  });

  it('keeps Brand open when the pointer moves from Category to Brand', () => {
    render(<DesktopNav categories={TREE} brands={BRANDS} />);
    const category = screen.getByRole('button', { name: 'Category' });
    const brand = screen.getByRole('button', { name: 'Brand' });

    fireEvent.pointerEnter(category.closest('li') as HTMLElement, mouse);
    fireEvent.pointerLeave(category.closest('li') as HTMLElement, mouse);
    fireEvent.pointerEnter(brand.closest('li') as HTMLElement, mouse);
    // Category's delayed close fires after Brand has opened: it must not shut Brand.
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(brand.getAttribute('aria-expanded')).toBe('true');
    expect(category.getAttribute('aria-expanded')).toBe('false');
  });

  it('still closes a menu the pointer really leaves', () => {
    render(<DesktopNav categories={TREE} brands={BRANDS} />);
    const brand = screen.getByRole('button', { name: 'Brand' });

    fireEvent.pointerEnter(brand.closest('li') as HTMLElement, mouse);
    fireEvent.pointerLeave(brand.closest('li') as HTMLElement, mouse);
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(brand.getAttribute('aria-expanded')).toBe('false');
  });
});
