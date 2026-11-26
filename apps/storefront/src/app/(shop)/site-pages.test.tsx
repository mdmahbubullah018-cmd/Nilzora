import { INFO_PAGES, type PublicSitePage } from '@nilzora/contracts';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AboutPage, { generateMetadata as aboutMetadata } from './about/page';
import FaqPage, { generateMetadata as faqMetadata } from './help/faq/page';
import ReturnsPolicyPage, { generateMetadata as returnsMetadata } from './help/returns/page';
import ShippingPage from './help/shipping/page';
import PrivacyPage, { generateMetadata as privacyMetadata } from './privacy/page';
import TermsPage from './terms/page';

/*
 * The store's own pages. About, Privacy, Terms and the FAQ always exist: they show the shared
 * wording until the store publishes its own text. Returns and delivery information have no
 * built-in text, so they are a plain 404 until the store publishes them.
 */

const content = vi.hoisted(() => ({ getSitePage: vi.fn() }));
vi.mock('@/lib/site-content', () => content);

const seo = vi.hoisted(() => ({
  storeProfile: vi.fn(),
  siteUrl: () => new URL('https://shop.nilzora.test'),
}));
vi.mock('@/lib/seo', () => seo);

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

function page(slug: PublicSitePage['slug'], overrides: Partial<PublicSitePage> = {}) {
  return {
    slug,
    title: `Store ${slug}`,
    body: `The store's own ${slug} text.`,
    seoTitle: null,
    seoDescription: null,
    updatedAt: '2026-11-08T08:00:00.000Z',
    ...overrides,
  } satisfies PublicSitePage;
}

beforeEach(() => {
  seo.storeProfile.mockResolvedValue(null);
  content.getSitePage.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe.each([
  ['about', AboutPage, aboutMetadata, '/about'],
  ['privacy', PrivacyPage, privacyMetadata, '/privacy'],
  ['faq', FaqPage, faqMetadata, '/help/faq'],
] as const)('the %s page', (slug, Page, metadata, path) => {
  it('shows the store’s own text and metadata once it is published', async () => {
    content.getSitePage.mockResolvedValue(
      page(slug, { seoTitle: 'Custom title', seoDescription: 'Custom description' }),
    );
    render(await Page());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`Store ${slug}`);
    expect(screen.getByText(`The store's own ${slug} text.`)).toBeTruthy();
    await expect(metadata()).resolves.toMatchObject({
      title: 'Custom title',
      description: 'Custom description',
      alternates: { canonical: `https://shop.nilzora.test${path}` },
    });
  });

  it('keeps the built-in page when the store has published nothing', async () => {
    render(await Page());

    expect(screen.queryByText(`The store's own ${slug} text.`)).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    const meta = await metadata();
    expect(meta.title).not.toBe(`Store ${slug}`);
    expect(meta.alternates).toMatchObject({ canonical: `https://shop.nilzora.test${path}` });
  });
});

describe('the terms page', () => {
  it('shows the store’s own text once published, otherwise the shared terms', async () => {
    render(await TermsPage());
    expect(screen.queryByText("The store's own terms text.")).toBeNull();
    const builtIn = screen.getByRole('heading', { level: 1 }).textContent;

    content.getSitePage.mockResolvedValue(page('terms'));
    render(await TermsPage());
    expect(screen.getByText("The store's own terms text.")).toBeTruthy();
    expect(builtIn).not.toBe('Store terms');
  });
});

describe('the returns and delivery pages', () => {
  it.each([
    ['returns', ReturnsPolicyPage],
    ['shipping', ShippingPage],
  ] as const)(
    '%s shows the built-in policy until the store publishes its own',
    async (slug, Page) => {
      render(await Page());
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(INFO_PAGES[slug].title);
      // The built-in wording describes the process and promises no deadline.
      expect(document.body.textContent).not.toMatch(/\d+\s*(working\s+)?(days?|hours?)\b/i);
    },
  );

  it.each([
    ['returns', ReturnsPolicyPage],
    ['shipping', ShippingPage],
  ] as const)('%s shows the published text', async (slug, Page) => {
    content.getSitePage.mockResolvedValue(page(slug));
    render(await Page());

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`Store ${slug}`);
    expect(screen.getByText(`The store's own ${slug} text.`)).toBeTruthy();
  });

  it('describes the built-in policy to search engines, and the published one once it exists', async () => {
    const builtIn = await returnsMetadata();
    expect(builtIn).toMatchObject({
      title: INFO_PAGES.returns.title,
      alternates: { canonical: 'https://shop.nilzora.test/help/returns' },
    });
    expect(builtIn.robots).toBeUndefined();
    content.getSitePage.mockResolvedValue(page('returns', { seoTitle: 'Returns' }));
    await expect(returnsMetadata()).resolves.toMatchObject({
      title: 'Returns',
      alternates: { canonical: 'https://shop.nilzora.test/help/returns' },
    });
  });
});
