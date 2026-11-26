// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testCategory, testProduct } from './fixtures';
import { ProductCreateForm } from './product-create-form';
import { ProductDetailView, savedProductValues } from './product-detail-view';
import { productAbilities } from './product-rules';
import {
  checkCreateFields,
  checkEditFields,
  parseSizeChart,
  parseTags,
  sizeChartToText,
} from './product-validation';

const actions = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  checkSlug: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/lib/catalog-actions', () => ({
  createProductAction: actions.create,
  updateProductAction: actions.update,
  adjustStockAction: vi.fn(),
  submitForReviewAction: vi.fn(),
  withdrawReviewAction: vi.fn(),
  setProductStatusAction: vi.fn(),
}));
vi.mock('@/lib/slug-actions', () => ({ checkSlugAction: actions.checkSlug }));
vi.mock('@/lib/image-actions', () => ({
  uploadProductImageAction: vi.fn(),
  updateProductImageAltAction: vi.fn(),
  moveProductImageAction: vi.fn(),
  reorderProductImagesAction: vi.fn(),
  deleteProductImageAction: vi.fn(),
}));
vi.mock('@/lib/merch-actions', () => ({ setProductBrandAction: vi.fn() }));

const CSRF = { name: 'csrf_token', token: 'token-1' };

function createForm() {
  render(<ProductCreateForm csrf={CSRF} categories={[testCategory]} />);
}

function editView(product = testProduct({ tags: ['eid'], sizeChart: null })) {
  render(
    <ProductDetailView
      product={product}
      categories={[testCategory]}
      movements={{ kind: 'unavailable' }}
      abilities={productAbilities(['products.read', 'products.update', 'products.publish'])}
      csrf={CSRF}
    />,
  );
}

const field = (label: RegExp) => screen.getByLabelText<HTMLInputElement>(label);

beforeEach(() => {
  actions.create.mockReset().mockResolvedValue({ status: 'idle' });
  actions.update.mockReset().mockResolvedValue({ status: 'idle' });
  // By default the address check never answers (the field then says nothing).
  actions.checkSlug.mockReset().mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the product create form', () => {
  it('settles after it is shown instead of re-rendering on its own', async () => {
    // A form that keeps checking itself renders for ever, which starves the router: leaving
    // the page (or the redirect after saving) then never completes.
    let commits = 0;
    render(
      <Profiler
        id="create"
        onRender={() => {
          commits += 1;
        }}
      >
        <ProductCreateForm csrf={CSRF} categories={[testCategory]} />
      </Profiler>,
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    const settled = commits;
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(commits).toBe(settled);
  });

  it('makes the address from the name until it is typed by hand', () => {
    createForm();
    const name = field(/^Name/);
    const slug = field(/^Storefront address/);

    fireEvent.change(name, { target: { value: 'Cotton Panjabi & Kurta' } });
    expect(slug.value).toBe('cotton-panjabi-and-kurta');

    fireEvent.change(slug, { target: { value: 'my-panjabi' } });
    fireEvent.change(name, { target: { value: 'Linen Panjabi' } });
    // A typed address is kept whatever the name becomes.
    expect(slug.value).toBe('my-panjabi');

    // Clearing it hands the address back to the name.
    fireEvent.change(slug, { target: { value: '' } });
    expect(slug.value).toBe('linen-panjabi');
  });

  it('checks the address after typing pauses and offers the free alternative', async () => {
    actions.checkSlug.mockResolvedValue({ state: 'taken', suggestion: 'desk-lamp-2' });
    createForm();
    fireEvent.change(field(/^Name/), { target: { value: 'Desk lamp' } });

    expect(await screen.findByText('Taken', { exact: false }, { timeout: 2000 })).toBeTruthy();
    const sent = actions.checkSlug.mock.calls.at(-1)?.[0] as FormData;
    expect(sent.get('kind')).toBe('product');
    expect(sent.get('slug')).toBe('desk-lamp');
    expect(sent.get('csrf_token')).toBe('token-1');

    actions.checkSlug.mockResolvedValue({ state: 'available' });
    fireEvent.click(screen.getByRole('button', { name: 'Use desk-lamp-2' }));
    expect(field(/^Storefront address/).value).toBe('desk-lamp-2');
    expect(await screen.findByText('Available', {}, { timeout: 2000 })).toBeTruthy();
  });

  it('shows the contract’s messages beside fields once visited, and sends nothing with mistakes', async () => {
    createForm();
    const name = field(/^Name/);
    fireEvent.focus(name);
    fireEvent.blur(name);
    expect(
      await screen.findByText('Enter the product name in 160 characters or fewer.'),
    ).toBeTruthy();

    const price = field(/^Price \(BDT\)/);
    fireEvent.change(price, { target: { value: '12.345' } });
    fireEvent.blur(price);
    expect(await screen.findByText(/Enter the price in taka/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(screen.getByText('Choose a category.')).toBeTruthy());
    expect(screen.getByText(/Use 2 to 40 letters, digits or hyphens/)).toBeTruthy();
    expect(actions.create).not.toHaveBeenCalled();
  });

  it('lists the fields that need attention in the save bar, each one taking focus', async () => {
    createForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    const bar = within(screen.getByRole('region', { name: 'Save changes' }));
    const list = within(await bar.findByRole('list', { name: 'Check these fields:' }));
    expect(list.getByRole('button', { name: 'Category' })).toBeTruthy();
    expect(list.getByRole('button', { name: 'SKU' })).toBeTruthy();

    fireEvent.click(list.getByRole('button', { name: 'Name' }));
    expect(document.activeElement).toBe(field(/^Name/));
    // Typing what was asked takes the field off the list; nothing was sent meanwhile.
    fireEvent.change(field(/^Name/), { target: { value: 'Tea' } });
    await waitFor(() => expect(list.queryByRole('button', { name: 'Name' })).toBeNull());
    expect(actions.create).not.toHaveBeenCalled();
  });

  it('always offers Create draft, and Discard once something was typed', async () => {
    createForm();
    const bar = screen.getByRole('region', { name: 'Save changes' });
    expect(within(bar).getByRole('button', { name: 'Create draft' })).toBeTruthy();
    expect(within(bar).queryByRole('button', { name: 'Discard' })).toBeNull();

    fireEvent.change(field(/^Name/), { target: { value: 'Tea' } });
    expect(await within(bar).findByRole('button', { name: 'Discard' })).toBeTruthy();
    expect(within(bar).getByText('Unsaved changes')).toBeTruthy();
  });
});

describe('the product edit form', () => {
  it('shows the save bar only once something differs from the saved product', async () => {
    editView();
    expect(screen.queryByRole('region', { name: 'Save changes' })).toBeNull();

    fireEvent.change(field(/^Price \(BDT\)/), { target: { value: '2600' } });
    const bar = await screen.findByRole('region', { name: 'Save changes' });
    expect(within(bar).getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Discard' })).toBeTruthy();

    // Typing the saved value back is not a change.
    fireEvent.change(field(/^Price \(BDT\)/), { target: { value: '2500' } });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Save changes' })).toBeNull());
  });

  it('does not call a saved size chart with an empty last cell an unsaved change', async () => {
    editView(
      testProduct({
        tags: [],
        sizeChart: {
          columns: ['Size', 'Chest (cm)', 'Length (cm)'],
          rows: [
            ['M', '96', '72'],
            ['XL', '108', ''],
          ],
        },
      }),
    );
    // Let the form look at itself once: nothing was edited, so there is no save bar.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole('region', { name: 'Save changes' })).toBeNull();
  });

  it('discards every change, controlled fields included', async () => {
    editView();
    fireEvent.change(field(/^Name/), { target: { value: 'Renamed panjabi' } });
    fireEvent.change(field(/^Price \(BDT\)/), { target: { value: '9' } });
    const bar = await screen.findByRole('region', { name: 'Save changes' });

    fireEvent.click(within(bar).getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Save changes' })).toBeNull());
    expect(field(/^Name/).value).toBe('Cotton panjabi');
    expect(field(/^Price \(BDT\)/).value).toBe('2500');
    expect(field(/^Storefront address/).value).toBe('cotton-panjabi');
  });

  it('sends every editable section with one Save, through the form the fields belong to', async () => {
    editView();
    fireEvent.change(field(/^Most units per order/), { target: { value: '3' } });
    const bar = await screen.findByRole('region', { name: 'Save changes' });
    fireEvent.click(within(bar).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(actions.update).toHaveBeenCalledTimes(1));
    const sent = actions.update.mock.calls[0]?.[1] as FormData;
    expect(sent.getAll('section')).toEqual(['content', 'pricing', 'ordering']);
    expect(sent.get('maxOrderQuantity')).toBe('3');
    expect(sent.get('name')).toBe('Cotton panjabi');
    expect(sent.get('tags')).toBe('eid');
    expect(sent.get('sizeChart')).toBe('');
    expect(sent.get('csrf_token')).toBe('token-1');
  });

  it('warns before unsaved changes are lost', async () => {
    editView();
    fireEvent.change(field(/^Name/), { target: { value: 'Changed' } });
    await screen.findByRole('region', { name: 'Save changes' });

    // The warning is registered by an effect that runs just after the bar appears.
    await waitFor(() => {
      const unload = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);
    });

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const link = document.createElement('a');
    link.href = '/admin/orders';
    link.textContent = 'Orders';
    document.body.append(link);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(click);
    expect(confirm).toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(true);
    link.remove();
  });
});

describe('the product rules the form and the Server Action share', () => {
  it('parses tags and size charts with the contract', () => {
    expect(parseTags(' Summer  Sale, eid-2026,summer sale ')).toEqual({
      ok: true,
      value: ['summer sale', 'eid-2026'],
    });
    expect(parseTags('no_underscores').ok).toBe(false);
    expect(parseSizeChart('')).toEqual({ ok: true, value: null });
    const chart = parseSizeChart('Size | Chest\nM | 96');
    expect(chart).toEqual({ ok: true, value: { columns: ['Size', 'Chest'], rows: [['M', '96']] } });
    expect(sizeChartToText({ columns: ['Size', 'Chest'], rows: [['M', '96']] })).toBe(
      'Size | Chest\nM | 96',
    );
    expect(parseSizeChart(' | Chest\nM | 96').ok).toBe(false);
  });

  it('keeps a measurement unit and any kind of size in the chart text', () => {
    // Shoe sizes, waist sizes and custom sizes are entries like any other; the unit rides along.
    const shoes = parseSizeChart('@unit: cm\nSize | Foot length\n42 | 26.5\n43 | 27.3');
    expect(shoes).toEqual({
      ok: true,
      value: {
        columns: ['Size', 'Foot length'],
        rows: [
          ['42', '26.5'],
          ['43', '27.3'],
        ],
        unit: 'cm',
      },
    });
    expect(sizeChartToText({ columns: ['Size', 'Waist'], rows: [['32', '81']], unit: 'in' })).toBe(
      '@unit: in\nSize | Waist\n32 | 81',
    );
    expect(parseSizeChart('@unit: ft\nSize | Chest\nM | 96').ok).toBe(false);
  });

  it('reads and writes a chart that is one picture', () => {
    const picture = parseSizeChart('@unit: cm\n@image: library/6b1d-chart');
    expect(picture).toEqual({
      ok: true,
      value: { columns: [], rows: [], mode: 'image', imageKey: 'library/6b1d-chart', unit: 'cm' },
    });
    expect(
      sizeChartToText({ columns: [], rows: [], mode: 'image', imageKey: 'library/6b1d-chart' }),
    ).toBe('@image: library/6b1d-chart');
    // The picture must be a library key, never an address typed in.
    expect(parseSizeChart('@image: https://example.com/chart.png').ok).toBe(false);
  });

  it('checks a price against its former price and the order limit', () => {
    const saved = savedProductValues(testProduct());
    expect(checkEditFields(['pricing'], { ...saved, price: '3500' })).toEqual({
      compareAtPrice: 'Enter a former price higher than the price, or leave it empty.',
    });
    expect(checkEditFields(['ordering'], { ...saved, maxOrderQuantity: '101' })).toEqual({
      maxOrderQuantity: 'Enter a whole number from 1 to 100.',
    });
    expect(checkEditFields(['content', 'pricing', 'ordering'], saved)).toEqual({});
    expect(checkCreateFields({ name: '', slug: '', price: '' }).slug).toBeUndefined();
  });
});
