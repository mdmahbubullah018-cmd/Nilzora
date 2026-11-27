// @vitest-environment jsdom
import { MAX_PRODUCT_IMAGES, PRODUCT_IMAGE_MAX_BYTES, type ProductImage } from '@nilzora/contracts';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductDetailView } from './product-detail-view';
import { moveTo, ProductImageUploader } from './product-image-gallery';
import { PRODUCT_ID, testCategory, testProduct } from './fixtures';
import { clampRect, cropRect, cropSize, croppedName, moveRect } from './image-crop';
import { productAbilities } from './product-rules';
import { ProductTile } from './product-tile';

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
const images = vi.hoisted(() => ({
  upload: vi.fn(),
  alt: vi.fn(),
  move: vi.fn(),
  reorder: vi.fn(),
  remove: vi.fn(),
}));

// The upload form reads the router to refresh the page after a confirmed upload.
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/image-actions', () => ({
  uploadProductImageAction: images.upload,
  updateProductImageAltAction: images.alt,
  moveProductImageAction: images.move,
  reorderProductImagesAction: images.reorder,
  deleteProductImageAction: images.remove,
}));
vi.mock('@/lib/catalog-actions', () => ({
  createProductAction: vi.fn(),
  updateProductAction: vi.fn(),
  adjustStockAction: vi.fn(),
  submitForReviewAction: vi.fn(),
  withdrawReviewAction: vi.fn(),
  setProductStatusAction: vi.fn(),
  saveCategoryAction: vi.fn(),
  setCategoryActiveAction: vi.fn(),
}));
vi.mock('@/lib/slug-actions', () => ({ checkSlugAction: vi.fn(() => new Promise(() => {})) }));
vi.mock('@/lib/merch-actions', () => ({ setProductBrandAction: vi.fn() }));

const CSRF = { name: 'csrf_token', token: 'token-1' };
const IDLE = { status: 'idle' } as const;

function image(n: number, overrides: Partial<ProductImage> = {}): ProductImage {
  return {
    id: `1a000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`,
    url: `https://media.example.com/p/${n}/full.webp`,
    thumbUrl: `https://media.example.com/p/${n}/thumb.webp`,
    alt: null,
    width: 1200,
    height: 900,
    position: n,
    ...overrides,
  };
}

function view(
  options: {
    permissions?: Parameters<typeof productAbilities>[0];
    product?: Parameters<typeof testProduct>[0];
    images?: ProductImage[];
  } = {},
) {
  const list = options.images ?? [image(0, { alt: 'Front view' }), image(1)];
  const product = testProduct({ images: list, image: list[0] ?? null, ...options.product });
  render(
    <ProductDetailView
      product={product}
      categories={[testCategory]}
      movements={{ kind: 'unavailable' }}
      abilities={productAbilities(options.permissions ?? ['products.read', 'products.update'])}
      csrf={CSRF}
    />,
  );
  return screen.getByRole('region', { name: 'Media' });
}

const fileInput = (section: HTMLElement) =>
  within(section).getByLabelText<HTMLInputElement>('Add images');
const uploadButton = (section: HTMLElement) =>
  within(section).getByRole<HTMLButtonElement>('button', { name: /^Upload/ });

function png(name: string, size = 1000): File {
  const file = new File(['x'], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

/** A stand-in for XMLHttpRequest that the test answers by hand. */
class FakeRequest {
  static sent: FakeRequest[] = [];
  upload: { onprogress?: (event: ProgressEvent) => void; onload?: () => void } = {};
  onerror?: () => void;
  ontimeout?: () => void;
  onabort?: () => void;
  onload?: () => void;
  status = 0;
  responseText = '';
  body: FormData | null = null;
  open() {}
  setRequestHeader() {}
  abort() {
    this.onabort?.();
  }
  send(body: FormData) {
    this.body = body;
    FakeRequest.sent.push(this);
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }
  answer(state: unknown) {
    this.upload.onload?.();
    this.status = 200;
    this.responseText = JSON.stringify(state);
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }
}

beforeEach(() => {
  FakeRequest.sent = [];
  for (const fn of Object.values(images)) fn.mockReset().mockResolvedValue(IDLE);
  for (const fn of Object.values(router)) fn.mockReset();
});
afterEach(cleanup);

describe('the product media section', () => {
  it('shows the pictures in order with a cover mark and fallback descriptions', () => {
    const section = view();

    const list = within(section).getByRole('list', { name: 'Product images' });
    const pictures = within(list).getAllByRole('img');
    expect(pictures).toHaveLength(2);
    expect(pictures[0]?.getAttribute('alt')).toBe('Front view');
    expect(pictures[1]?.getAttribute('alt')).toBe('Product image 2');
    expect(pictures[0]?.getAttribute('src')).toBe('https://media.example.com/p/0/thumb.webp');
    expect(pictures[0]?.getAttribute('loading')).toBe('lazy');
    expect(pictures[0]?.getAttribute('width')).toBe('1200');
    expect(within(list).getByText('Cover')).toBeTruthy();
    expect(within(list).getByText('Image 2')).toBeTruthy();
  });

  it('offers description, order, cover, removal and upload controls to an editor', () => {
    const section = view();

    expect(within(section).getAllByRole('button', { name: 'Save description' })).toHaveLength(2);
    const earlier = within(section).getAllByRole<HTMLButtonElement>('button', { name: /earlier/ });
    const later = within(section).getAllByRole<HTMLButtonElement>('button', { name: /later/ });
    // The first picture cannot go earlier and the last cannot go later.
    expect(earlier[0]?.disabled).toBe(true);
    expect(earlier[1]?.disabled).toBe(false);
    expect(later[0]?.disabled).toBe(false);
    expect(later[1]?.disabled).toBe(true);
    // Only pictures after the cover can become the cover.
    expect(within(section).getAllByRole('button', { name: /Set as cover/ })).toHaveLength(1);
    expect(within(section).getAllByText('Remove')).toHaveLength(2);
    expect(fileInput(section).multiple).toBe(true);
    expect(within(section).getByText(/2 of 8 added/)).toBeTruthy();
    expect(uploadButton(section)).toBeTruthy();
  });

  it('names every picture to the move form in its current order, with the CSRF field', () => {
    const section = view();

    const orderField = section.querySelector<HTMLInputElement>('input[name="order"]');
    expect(orderField?.value).toBe(`${image(0).id},${image(1).id}`);
    for (const form of section.querySelectorAll('form')) {
      expect(form.querySelector<HTMLInputElement>('input[name="csrf_token"]')?.value).toBe(
        'token-1',
      );
    }
    expect(section.querySelector<HTMLInputElement>('input[name="productId"]')?.value).toBe(
      PRODUCT_ID,
    );
  });

  it('moves a picture with the keyboard buttons and makes one the cover', async () => {
    const section = view();

    fireEvent.click(within(section).getByRole('button', { name: 'Move image 1 later' }));
    await waitFor(() => expect(images.move).toHaveBeenCalledTimes(1));
    const moved = images.move.mock.calls[0]?.[1] as FormData;
    expect(moved.get('imageId')).toBe(image(0).id);
    expect(moved.get('direction')).toBe('later');

    fireEvent.click(within(section).getByRole('button', { name: /Set as cover/ }));
    await waitFor(() => expect(images.move).toHaveBeenCalledTimes(2));
    const cover = images.move.mock.calls[1]?.[1] as FormData;
    expect(cover.get('imageId')).toBe(image(1).id);
    expect(cover.get('direction')).toBe('first');
    expect(cover.get('order')).toBe(`${image(0).id},${image(1).id}`);
  });

  it('saves the order a picture is dragged into', async () => {
    const section = view({ images: [image(0), image(1), image(2)] });
    const cards = within(within(section).getByRole('list', { name: 'Product images' }))
      .getAllByRole('listitem')
      .filter((item) => item.getAttribute('draggable') === 'true');
    expect(cards).toHaveLength(3);

    fireEvent.dragStart(cards[2] as HTMLElement, {
      dataTransfer: { setData: vi.fn(), effectAllowed: '' },
    });
    fireEvent.drop(cards[0] as HTMLElement, { dataTransfer: {} });

    await waitFor(() => expect(images.reorder).toHaveBeenCalledTimes(1));
    const data = images.reorder.mock.calls[0]?.[1] as FormData;
    expect(data.get('order')).toBe([image(0), image(1), image(2)].map((i) => i.id).join(','));
    expect(data.get('next')).toBe([image(2), image(0), image(1)].map((i) => i.id).join(','));
    expect(data.get('csrf_token')).toBe('token-1');
  });

  it('accepts only the picture types the API takes', () => {
    const section = view();

    const input = fileInput(section);
    expect(input.type).toBe('file');
    expect(input.accept).toBe('image/jpeg,image/png,image/webp');
  });

  it('invites the first upload when there are no pictures', () => {
    const section = view({ images: [] });

    expect(within(section).getByText('No images yet')).toBeTruthy();
    expect(within(section).queryByRole('list', { name: 'Product images' })).toBeNull();
    expect(fileInput(section)).toBeTruthy();
    expect(within(section).getByText(/0 of 8 added/)).toBeTruthy();
  });

  it('stops uploads at the limit and says why', () => {
    const list = Array.from({ length: MAX_PRODUCT_IMAGES }, (_, n) => image(n));
    const section = view({ images: list });

    expect(within(section).getByText(/8 of 8 added/)).toBeTruthy();
    expect(fileInput(section).disabled).toBe(true);
    expect(uploadButton(section).disabled).toBe(true);
    expect(within(section).getByText(/most pictures it can keep/)).toBeTruthy();
  });

  it('refuses a file over 5 MB on the spot and blocks the upload button', () => {
    const section = view();
    const input = fileInput(section);

    fireEvent.change(input, { target: { files: [png('big.png', PRODUCT_IMAGE_MAX_BYTES + 1)] } });

    expect(within(section).getByText(/larger than 5 MB/)).toBeTruthy();
    expect(uploadButton(section).disabled).toBe(true);

    // Choosing a usable file clears the message and queues it.
    fireEvent.change(input, { target: { files: [png('ok.png')] } });
    expect(within(section).queryByText(/larger than 5 MB/)).toBeNull();
    expect(uploadButton(section).disabled).toBe(false);
    expect(within(section).getByRole('list', { name: 'Pictures to upload' })).toBeTruthy();
  });

  it('refuses a file type the API does not take on the spot', () => {
    const section = view();

    fireEvent.change(fileInput(section), {
      target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] },
    });

    expect(within(section).getByText('Upload a JPEG, PNG or WebP picture.')).toBeTruthy();
  });

  it('locks the pictures while the product is on sale, still showing them', () => {
    const section = view({ product: { status: 'active', moderationStatus: 'approved' } });

    expect(
      within(section).getByText('Images are locked while the product is on sale'),
    ).toBeTruthy();
    expect(within(section).getAllByRole('img')).toHaveLength(2);
    expect(within(section).queryByRole('button', { name: 'Save description' })).toBeNull();
    expect(within(section).queryByLabelText('Add images')).toBeNull();
    expect(within(section).queryByText('Remove')).toBeNull();
  });

  it('locks the pictures while the content is under review', () => {
    const section = view({ product: { moderationStatus: 'pending' } });

    expect(
      within(section).getByText('Images are locked while the content is under review'),
    ).toBeTruthy();
    expect(within(section).queryByLabelText('Add images')).toBeNull();
  });

  it('shows the pictures read-only to an account that cannot edit products', () => {
    const section = view({ permissions: ['products.read'] });

    expect(within(section).getAllByRole('img')).toHaveLength(2);
    expect(
      within(section).getByText(
        'Your account can view products but not change their images or videos.',
      ),
    ).toBeTruthy();
    expect(within(section).queryByLabelText('Add images')).toBeNull();
    expect(within(section).queryByRole('button', { name: 'Save description' })).toBeNull();
    expect(section.querySelector('form')).toBeNull();
  });
});

describe('the upload queue', () => {
  function uploader(imageCount = 0) {
    render(
      <ProductImageUploader
        productId={PRODUCT_ID}
        csrf={CSRF}
        imageCount={imageCount}
        createRequest={() => new FakeRequest() as unknown as XMLHttpRequest}
      />,
    );
    return screen.getByLabelText<HTMLInputElement>('Add images');
  }

  it('queues several files at once, each removable, within the free slots', () => {
    const input = uploader(MAX_PRODUCT_IMAGES - 2);

    fireEvent.change(input, { target: { files: [png('a.png'), png('b.png'), png('c.png')] } });

    const queue = screen.getByRole('list', { name: 'Pictures to upload' });
    expect(within(queue).getAllByRole('listitem')).toHaveLength(2);
    // The third does not fit: the product keeps at most 8 pictures.
    expect(screen.getByText('c.png:')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload 2 images' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove from queue: a.png' }));
    expect(within(queue).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Upload image' })).toBeTruthy();
  });

  it('sends the files one by one with progress, then refreshes the product', async () => {
    const input = uploader();
    fireEvent.change(input, { target: { files: [png('a.png'), png('b.png')] } });
    fireEvent.change(screen.getByLabelText('Description of a.png'), {
      target: { value: 'Front view' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Upload 2 images' }));
    await waitFor(() => expect(FakeRequest.sent).toHaveLength(1));
    const first = FakeRequest.sent[0] as FakeRequest;
    expect(first.body?.get('productId')).toBe(PRODUCT_ID);
    expect(first.body?.get('csrf_token')).toBe('token-1');
    expect(first.body?.get('alt')).toBe('Front view');
    expect((first.body?.get('image') as File).name).toBe('a.png');

    act(() => first.progress(500, 1000));
    expect(
      screen.getByRole('progressbar', { name: 'Uploading a.png' }).getAttribute('aria-valuenow'),
    ).toBe('50');

    act(() => first.answer({ status: 'success', message: 'Image added to the product.' }));
    await waitFor(() => expect(FakeRequest.sent).toHaveLength(2));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    act(() => (FakeRequest.sent[1] as FakeRequest).answer({ status: 'success' }));

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        `/admin/products/${PRODUCT_ID}?notice=image-added`,
      ),
    );
  });

  it('offers a retry only when nothing reached the server, and sends the file again', async () => {
    const input = uploader();
    fireEvent.change(input, { target: { files: [png('a.png')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }));
    await waitFor(() => expect(FakeRequest.sent).toHaveLength(1));

    act(() => (FakeRequest.sent[0] as FakeRequest).fail());
    expect(await screen.findByText(/Nothing was saved/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Try again: a.png' }));
    await waitFor(() => expect(FakeRequest.sent).toHaveLength(2));
    act(() => (FakeRequest.sent[1] as FakeRequest).answer({ status: 'success' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });

  it('shows the server’s refusal and does not offer a retry after the bytes arrived', async () => {
    const input = uploader();
    fireEvent.change(input, { target: { files: [png('a.png')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload image' }));
    await waitFor(() => expect(FakeRequest.sent).toHaveLength(1));

    const request = FakeRequest.sent[0] as FakeRequest;
    act(() => {
      request.upload.onload?.();
      request.fail();
    });
    expect(await screen.findByText(/Reload the page and check/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('image helpers', () => {
  it('moves an id to a new place in the order', () => {
    expect(moveTo(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(moveTo(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
    expect(moveTo(['a', 'b', 'c'], 'b', 9)).toEqual(['a', 'c', 'b']);
  });

  it('crops to the largest centred square or 4:5 area, zoomed and kept inside', () => {
    expect(cropSize(1200, 800, 1)).toEqual({ width: 800, height: 800 });
    expect(cropSize(1000, 2000, 4 / 5)).toEqual({ width: 1000, height: 1250 });
    expect(cropSize(1200, 800, null, 2)).toEqual({ width: 600, height: 400 });
    expect(cropRect(1200, 800, 1)).toEqual({ x: 200, y: 0, width: 800, height: 800 });
    expect(clampRect({ x: -50, y: 900, width: 400, height: 400 }, 1200, 800)).toEqual({
      x: 0,
      y: 400,
      width: 400,
      height: 400,
    });
    expect(moveRect({ x: 0, y: 0, width: 800, height: 800 }, 1000, 0, 1200, 800).x).toBe(400);
    expect(croppedName('photo.jpg', 'image/jpeg')).toBe('photo-crop.jpg');
    expect(croppedName('shot.png', 'image/png')).toBe('shot-crop.png');
  });
});

describe('ProductTile', () => {
  it('shows the primary picture when the product has one, as decoration', () => {
    const { container } = render(
      <ProductTile
        categorySlug="fashion"
        image={{ thumbUrl: 'https://media.example.com/t.webp' }}
      />,
    );

    const picture = container.querySelector('img');
    expect(picture?.getAttribute('src')).toBe('https://media.example.com/t.webp');
    expect(picture?.getAttribute('alt')).toBe('');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('falls back to the category icon without one', () => {
    const { container } = render(<ProductTile categorySlug="fashion" image={null} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
