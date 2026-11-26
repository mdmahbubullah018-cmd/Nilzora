import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavAnchor } from './layout/nav-anchor';
import { SiteHeader } from './site-header';

/*
 * Links the store added to the header menu show in the desktop navigation and in the phone
 * menu, after the built-in ones; a store path stays inside the site and an https address
 * opens in a new tab. With no managed links the header is unchanged (site-header.test.tsx).
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/products',
  useRouter: () => ({ push: vi.fn() }),
}));

class FakeIntersectionObserver {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ count: 0 })))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const extra = [
  { label: 'Eid sale', href: '/products?sort=newest' },
  { label: 'Our blog', href: 'https://blog.nilzora.example/latest' },
];

describe('SiteHeader with managed links', () => {
  it('lists them after New Arrivals in the main navigation', () => {
    render(<SiteHeader extraLinks={extra} />);

    const main = within(screen.getByRole('navigation', { name: 'Main' }));
    const labels = main.getAllByRole('link').map((link) => link.textContent);
    expect(labels.indexOf('New Arrivals')).toBeGreaterThan(-1);
    expect(labels.indexOf('Eid sale')).toBe(labels.indexOf('New Arrivals') + 1);
    expect(main.getByRole('link', { name: 'Eid sale' }).getAttribute('href')).toBe(
      '/products?sort=newest',
    );
    const blog = main.getByRole('link', { name: /Our blog/ });
    expect(blog.getAttribute('href')).toBe('https://blog.nilzora.example/latest');
    expect(blog.getAttribute('target')).toBe('_blank');
    expect(blog.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows none of them when the store manages no links', () => {
    render(<SiteHeader />);

    const main = within(screen.getByRole('navigation', { name: 'Main' }));
    expect(main.queryByRole('link', { name: 'Eid sale' })).toBeNull();
  });
});

describe('NavAnchor', () => {
  it('renders nothing for an address that is neither a store path nor https', () => {
    const { container } = render(
      <>
        <NavAnchor href="javascript:alert(1)">Bad</NavAnchor>
        <NavAnchor href="//evil.example">Worse</NavAnchor>
        <NavAnchor href="http://plain.example">Plain</NavAnchor>
      </>,
    );

    expect(container.querySelector('a')).toBeNull();
  });
});
