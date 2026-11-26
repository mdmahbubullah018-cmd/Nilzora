import type { PublicSitePage } from '@nilzora/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SitePageView } from './site-page-view';

const page: PublicSitePage = {
  slug: 'returns',
  title: 'Returns policy',
  body: '# How it works\n\nTell us within 7 days.\n\n- Keep the box\n- Bring the receipt\n\n## Refunds\nBy cash.',
  seoTitle: null,
  seoDescription: null,
  updatedAt: '2026-11-08T08:00:00.000Z',
};

describe('SitePageView', () => {
  it('draws the title, headings, paragraphs and lists the store wrote', () => {
    render(<SitePageView page={page} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Returns policy' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'How it works' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Refunds' })).toBeTruthy();
    expect(screen.getByText('Tell us within 7 days.')).toBeTruthy();
    for (const text of ['Keep the box', 'Bring the receipt']) {
      expect(screen.getByText(text).closest('li')).not.toBeNull();
    }
    expect(screen.getByText(/Last updated/).textContent).toContain('2026');
  });

  it('shows markup as text and never creates elements from it', () => {
    const { container } = render(
      <SitePageView
        page={{
          ...page,
          body: '<script>window.hacked = true</script>\n\n<img src=x onerror=alert(1)>',
        }}
      />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<script>window.hacked = true</script>')).toBeTruthy();
    expect(container.innerHTML).not.toContain('<script');
  });
});
