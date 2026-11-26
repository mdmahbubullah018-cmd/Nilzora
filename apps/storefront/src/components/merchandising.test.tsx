import type { Banner, Brand } from '@nilzora/contracts';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandGrid, CampaignBanners, CategoryBanner } from './merchandising';

/*
 * The promotion strip. The rules that matter: it is ONE horizontally scrolling row (not a
 * grid), a banner's words are all optional, an image-only banner still draws, and only a
 * banner with a destination the store can open is a link.
 */

function banner(overrides: Partial<Banner> = {}): Banner {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    placement: 'home_secondary',
    title: '',
    subtitle: null,
    ctaLabel: null,
    ctaHref: null,
    image: {
      url: 'https://media.example.com/b/1/full.webp',
      thumbUrl: 'https://media.example.com/b/1/thumb.webp',
    },
    categorySlug: null,
    ...overrides,
  };
}

describe('CampaignBanners', () => {
  it('renders nothing at all when there is no promotion', () => {
    const { container } = render(<CampaignBanners banners={[]} />);

    expect(container.innerHTML).toBe('');
  });

  it('puts every banner in one horizontally scrolling row', () => {
    const { container } = render(
      <CampaignBanners
        banners={[banner({ id: crypto.randomUUID() }), banner({ id: crypto.randomUUID() })]}
      />,
    );

    const list = screen.getByRole('list');
    expect(list.className).toContain('overflow-x-auto');
    expect(list.className).toContain('snap-x');
    expect(list.className).not.toContain('grid-cols');
    expect(list.children).toHaveLength(2);
    expect(container.querySelectorAll('img')).toHaveLength(2);
    // One banner at a time on a phone (the next peeks in); from `sm` two full banners plus about
    // a fifth of the third at the right edge.
    const item = list.children[0];
    expect(item?.className).toContain('w-[88%]');
    expect(item?.className).toContain('sm:w-[calc((100%-2rem)/2.11)]');
    expect(item?.className).toContain('lg:w-[calc((100%-3rem)/2.18)]');
    expect(item?.className).toContain('shrink-0');
  });

  it('draws an image-only banner without inventing any text', () => {
    const { container } = render(<CampaignBanners banners={[banner({ title: '' })]} />);

    // Just the picture: no caption block, and nothing for a screen reader to announce.
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('https://media.example.com/b/1/full.webp');
    expect(image?.getAttribute('alt')).toBe('');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the words a banner has, and only links one with a destination', () => {
    render(
      <CampaignBanners
        banners={[
          banner({
            title: 'Eid sale',
            subtitle: 'Up to 40% off',
            ctaLabel: 'Shop the sale',
            ctaHref: '/categories/fashion',
          }),
          banner({ id: '00000000-0000-4000-8000-000000000002', title: 'No destination' }),
          banner({
            id: '00000000-0000-4000-8000-000000000003',
            title: 'Elsewhere',
            ctaLabel: 'Open',
            ctaHref: 'https://example.com/not-us',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Eid sale')).toBeTruthy();
    expect(screen.getByText('Up to 40% off')).toBeTruthy();
    // One link: the internal destination. The off-store href is never rendered as a link.
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('/categories/fashion');
    expect(screen.getByText('Shop the sale')).toBeTruthy();
    expect(screen.getByText('Elsewhere')).toBeTruthy();
  });

  it('uses a banner’s phone picture on small screens when it has one', () => {
    const { container } = render(
      <CampaignBanners
        banners={[
          banner({
            mobileImage: {
              url: 'https://media.example.com/b/1/mobile.webp',
              thumbUrl: 'https://media.example.com/b/1/mobile-thumb.webp',
            },
          }),
        ]}
      />,
    );

    expect(container.querySelector('source')?.getAttribute('srcSet')).toBe(
      'https://media.example.com/b/1/mobile.webp',
    );
  });

  it('draws the words on the picture in a ~96% transparent container, with no shadow on the card', () => {
    const { container } = render(
      <CampaignBanners banners={[banner({ title: 'Eid sale', subtitle: 'Up to 40% off' })]} />,
    );

    const frame = container.querySelector('picture')?.parentElement;
    // One shape at every width — the same 12:5 the mobile app frames the same banner in — so the
    // strip never changes proportion between the phone browser and the app.
    expect(frame?.className).toContain('aspect-12/5');

    const caption = [...(frame?.querySelectorAll('div') ?? [])].find((node) =>
      node.className.includes('bg-white/[0.04]'),
    );
    expect(caption).toBeTruthy();
    // On the artwork, not under it, and only 4% tint plus a soft blur.
    expect(caption?.className).toContain('absolute');
    expect(caption?.className).toContain('bottom-0');
    expect(caption?.className).toContain('backdrop-blur');
    // The type keeps its contrast with a shadow instead of an opaque panel.
    expect(caption?.querySelector('p')?.className).toContain('text-shadow');
    // No drop shadow anywhere on the banner card.
    expect(container.querySelector('[class*="shadow-"]')).toBeNull();
  });

  it('keeps a picture-only banner free of any caption block', () => {
    const { container } = render(<CampaignBanners banners={[banner({ title: '' })]} />);

    expect(container.querySelector('[class*="bg-white/["]')).toBeNull();
    expect(container.textContent).toBe('');
  });
});

describe('BrandGrid', () => {
  it('shows each logo contained in its own band, and initials when there is none', () => {
    const brands: Brand[] = [
      {
        slug: 'north-star',
        name: 'North Star',
        description: 'Outdoor essentials',
        logo: {
          url: 'https://media.example.com/brands/ns/full.webp',
          thumbUrl: 'https://media.example.com/brands/ns/thumb.webp',
        },
        banner: null,
        productCount: 4,
      },
      {
        slug: 'plain-co',
        name: 'Plain Co',
        description: null,
        logo: null,
        banner: null,
        productCount: 0,
      },
    ];
    const { container } = render(<BrandGrid brands={brands} />);

    const logo = container.querySelector('img');
    expect(logo?.getAttribute('src')).toBe('https://media.example.com/brands/ns/thumb.webp');
    // Contained, never stretched: a wordmark and an emblem keep their proportions.
    expect(logo?.className).toContain('object-contain');
    // The logo keeps a category card's picture area, with nothing drawn around it.
    let pictureArea = logo?.parentElement ?? null;
    while (pictureArea !== null && !pictureArea.className.includes('aspect-4/3')) {
      pictureArea = pictureArea.parentElement;
    }
    expect(pictureArea).toBeTruthy();
    // The words sit under the picture, centred, never over the artwork.
    expect(within(pictureArea as HTMLElement).queryByText('North Star')).toBeNull();
    const tile = pictureArea?.parentElement as HTMLElement;
    // A card in the All Categories idiom: a bordered, rounded surface holding the mark, the
    // name and the real count inside its own boundary.
    expect(tile.className).toContain('text-center');
    expect(tile.className).toContain('rounded-2xl');
    expect(tile.className).toContain('border');
    expect(tile.className).toContain('bg-surface');
    const name = within(tile).getByText('North Star');
    // Centring comes from the tile, so a wrapped name stays centred with its count beneath it.
    expect(name.closest('.text-center')).not.toBeNull();
    const count = within(tile).getByText('4 products');
    expect(count.closest('.text-center')).not.toBeNull();
    // The brand with no logo shows its initials instead of a broken picture.
    expect(screen.getByText('PC')).toBeTruthy();
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/north-star', '/plain-co']);
  });
});

describe('CategoryBanner', () => {
  it('keeps the message over the picture readable and links only a real destination', () => {
    render(<CategoryBanner banner={banner({ title: 'Winter picks', subtitle: 'New coats' })} />);

    expect(screen.getByText('Winter picks')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('draws the words on a pictured strip, and the whole band becomes the link', () => {
    const { container } = render(
      <CategoryBanner
        banner={banner({ title: 'Winter picks', ctaLabel: 'Shop', ctaHref: '/products' })}
      />,
    );

    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/products');
    // The words are inside the linked artwork, in the shared 4% container.
    const caption = container.querySelector('[class*="bg-white/[0.04]"]');
    expect(caption).toBeTruthy();
    expect(link.contains(caption)).toBe(true);
    // The label is not a second, competing button.
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('keeps its own words row when the banner has no picture', () => {
    const { container } = render(
      <CategoryBanner
        banner={banner({
          title: 'Winter picks',
          ctaLabel: 'Shop',
          ctaHref: '/products',
          image: null,
        })}
      />,
    );

    expect(container.querySelector('[class*="bg-white/[0.04]"]')).toBeNull();
    expect(screen.getByText('Winter picks')).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/products');
  });
});
