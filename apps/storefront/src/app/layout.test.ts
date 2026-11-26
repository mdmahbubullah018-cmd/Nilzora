import { describe, expect, it, vi } from 'vitest';

/*
 * The root layout is where the store's default metadata becomes the metadata of every page.
 * This test proves that wiring — the layout asks the SEO module and publishes its answer —
 * without pretending to render the document (the fonts and CSS are mocked).
 */

const seo = vi.hoisted(() => ({ rootMetadata: vi.fn() }));

vi.mock('@/lib/seo', () => seo);
vi.mock('next/font/google', () => {
  const font = () => ({ variable: '--font-mock', className: 'mock-font' });
  return { Inter: font, Poppins: font, Noto_Sans_Bengali: font };
});

describe('root layout metadata', () => {
  it('publishes exactly what the SEO module resolved', async () => {
    const resolved = {
      title: { default: 'Nilzora — everyday essentials', template: '%s · Nilzora' },
      description: 'One shop, a small catalogue.',
    };
    seo.rootMetadata.mockResolvedValue(resolved);

    const layout = await import('./layout');

    await expect(layout.generateMetadata()).resolves.toStrictEqual(resolved);
    expect(seo.rootMetadata).toHaveBeenCalledTimes(1);
  });

  it('has no static metadata left to shadow the store profile', async () => {
    const layout = await import('./layout');

    expect('metadata' in layout).toBe(false);
  });

  it('still publishes the theme colour viewport', async () => {
    const layout = await import('./layout');

    expect(layout.viewport.themeColor).toBe('#0F172A');
  });
});
