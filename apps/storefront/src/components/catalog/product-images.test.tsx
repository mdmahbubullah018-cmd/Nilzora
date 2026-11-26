import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { productImage, summary } from '@/testing/catalog-fixtures';
import { ProductCard } from './product-card';
import { ProductGallery } from './product-gallery';
import { ProductImage } from './product-image';

describe('ProductCard pictures', () => {
  it('shows the thumbnail, described by the product name, in a frame that keeps its shape', () => {
    const image = productImage({ width: 1600, height: 1200 });
    const product = summary({ name: 'Cotton Bedsheet Set', image });
    const { container } = render(<ProductCard product={product} />);

    const picture = screen.getByRole('img', { name: 'Cotton Bedsheet Set' });
    expect(picture.getAttribute('src')).toBe(image.thumbUrl);
    expect(picture.getAttribute('width')).toBe('1600');
    expect(picture.getAttribute('height')).toBe('1200');
    expect(picture.getAttribute('loading')).toBe('lazy');
    expect(picture.parentElement?.className).toContain('aspect-square');
    // The picture adds no tab stop: the name stays the card's only link.
    expect(container.querySelectorAll('a')).toHaveLength(1);
  });

  it('uses the picture’s own description when it has one', () => {
    const product = summary({ name: 'Mug', image: productImage({ alt: 'A blue ceramic mug' }) });
    render(<ProductCard product={product} />);
    expect(screen.getByRole('img', { name: 'A blue ceramic mug' })).not.toBeNull();
  });

  it('shows the branded placeholder, and no <img>, for a product without a picture', () => {
    const { container } = render(<ProductCard product={summary({ image: null })} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('falls back to the placeholder when the file cannot be loaded', () => {
    const { container } = render(<ProductCard product={summary({ image: productImage() })} />);
    fireEvent.error(screen.getByRole('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('ProductImage load failures', () => {
  it('falls back when the file had already failed before the page was interactive', () => {
    // Server-rendered markup can finish loading (and fail) before React listens for onError.
    const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    const naturalWidth = vi
      .spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get')
      .mockReturnValue(0);
    try {
      const { container } = render(<ProductImage image={productImage()} productName="Lamp" />);
      expect(container.querySelector('img')).toBeNull();
      expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    } finally {
      complete.mockRestore();
      naturalWidth.mockRestore();
    }
  });

  it('keeps a file that loaded', () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    const naturalWidth = vi
      .spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get')
      .mockReturnValue(480);
    try {
      const { container } = render(<ProductImage image={productImage()} productName="Lamp" />);
      expect(container.querySelector('img')).not.toBeNull();
    } finally {
      complete.mockRestore();
      naturalWidth.mockRestore();
    }
  });
});

describe('ProductImage', () => {
  it('loads the full-size file with priority when asked', () => {
    const image = productImage();
    render(<ProductImage image={image} productName="Lamp" variant="full" priority />);
    const picture = screen.getByRole('img', { name: 'Lamp' });
    expect(picture.getAttribute('src')).toBe(image.url);
    expect(picture.getAttribute('loading')).toBe('eager');
    expect(picture.getAttribute('fetchpriority')).toBe('high');
  });
});

describe('ProductGallery', () => {
  const images = [
    productImage({ position: 0, alt: 'Front view' }),
    productImage({ position: 1, alt: null }),
    productImage({ position: 2, alt: 'Back view' }),
  ];

  function mainPicture(): HTMLElement {
    // The large picture is the only <img> outside the thumbnail group.
    const group = screen.getByRole('group', { name: 'Product pictures' });
    const all = screen.getAllByRole('img');
    const main = all.find((img) => !group.contains(img));
    if (!main) throw new Error('main picture missing');
    return main;
  }

  it('shows the first picture large and eager, with one thumbnail button per picture', () => {
    render(<ProductGallery images={images} productName="Lamp" />);

    const main = mainPicture();
    expect(main.getAttribute('src')).toBe(images[0]?.url);
    expect(main.getAttribute('alt')).toBe('Front view');
    expect(main.getAttribute('loading')).toBe('eager');

    const group = screen.getByRole('group', { name: 'Product pictures' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('false');
    for (const thumb of within(group).getAllByRole('img', { hidden: true })) {
      expect(thumb.getAttribute('loading')).toBe('lazy');
    }
  });

  it('switches the large picture when a thumbnail is chosen, naming it by the product when it has no description', () => {
    render(<ProductGallery images={images} productName="Lamp" />);
    const group = screen.getByRole('group', { name: 'Product pictures' });
    const buttons = within(group).getAllByRole('button');

    fireEvent.click(buttons[1] as HTMLElement);

    const main = mainPicture();
    expect(main.getAttribute('src')).toBe(images[1]?.url);
    expect(main.getAttribute('alt')).toBe('Lamp');
    expect(main.getAttribute('loading')).toBe('lazy');
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('false');
  });

  it('moves between thumbnails with the arrow, Home and End keys, wrapping around', () => {
    render(<ProductGallery images={images} productName="Lamp" />);
    const group = screen.getByRole('group', { name: 'Product pictures' });
    const buttons = within(group).getAllByRole('button');

    fireEvent.keyDown(buttons[0] as HTMLElement, { key: 'ArrowRight' });
    expect(mainPicture().getAttribute('src')).toBe(images[1]?.url);
    expect(document.activeElement).toBe(buttons[1]);

    fireEvent.keyDown(buttons[1] as HTMLElement, { key: 'End' });
    expect(mainPicture().getAttribute('src')).toBe(images[2]?.url);

    fireEvent.keyDown(buttons[2] as HTMLElement, { key: 'ArrowRight' });
    expect(mainPicture().getAttribute('src')).toBe(images[0]?.url);

    fireEvent.keyDown(buttons[0] as HTMLElement, { key: 'ArrowLeft' });
    expect(mainPicture().getAttribute('src')).toBe(images[2]?.url);

    fireEvent.keyDown(buttons[2] as HTMLElement, { key: 'Home' });
    expect(mainPicture().getAttribute('src')).toBe(images[0]?.url);
  });

  it('shows no thumbnail strip for a single picture', () => {
    render(<ProductGallery images={[images[0] as (typeof images)[number]]} productName="Lamp" />);
    expect(screen.queryByRole('group', { name: 'Product pictures' })).toBeNull();
    expect(screen.getAllByRole('img')).toHaveLength(1);
  });

  it('shows the placeholder when the product has no pictures', () => {
    const { container } = render(<ProductGallery images={[]} productName="Lamp" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  const video = {
    id: '9a000000-0000-4000-8000-000000000001',
    url: 'https://media.example/products/p/videos/v.mp4',
    contentType: 'video/mp4' as const,
    bytes: 2_000_000,
    title: 'On the shelf',
    position: 0,
  };

  it('puts videos after the pictures, as thumbnails that play in place, never as a link', () => {
    const { container } = render(
      <ProductGallery images={images} videos={[video]} productName="Lamp" />,
    );
    const group = screen.getByRole('group', { name: 'Product pictures and videos' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(buttons[3]?.getAttribute('aria-label')).toBe('Show On the shelf (4 of 4)');

    fireEvent.click(buttons[3] as HTMLElement);
    const player = container.querySelector('video[controls]');
    expect(player).not.toBeNull();
    expect(player?.getAttribute('aria-label')).toBe('On the shelf');
    expect(player?.querySelector('source')?.getAttribute('src')).toBe(video.url);
    expect(player?.querySelector('source')?.getAttribute('type')).toBe('video/mp4');
    // Played in the gallery: no link away, and no zoom button over the player.
    expect(container.querySelector(`a[href="${video.url}"]`)).toBeNull();
    expect(screen.queryByRole('button', { name: /full screen/ })).toBeNull();
  });

  it('shows a product that has only a video', () => {
    const { container } = render(
      <ProductGallery images={[]} videos={[video]} productName="Lamp" />,
    );
    expect(container.querySelector('video[controls] source')?.getAttribute('src')).toBe(video.url);
  });
});
