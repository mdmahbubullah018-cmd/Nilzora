import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CartLine } from '@nilzora/contracts';
import type { FormState } from '@nilzora/web-session';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CART_CHANGED_EVENT, type CartChangedDetail } from '@/lib/cart-events';
import { cartLine, cartQuote, LAMP_ID, MUG_ID } from '@/testing/commerce-fixtures';
import type { FormAction } from '../auth/form-kit';
import { CartLineItem, cartLineProblemText, productHref } from './cart-line';
import { CartFormsProvider } from './cart-line-controls';
import { CartSummary } from './cart-summary';

const idleAction: FormAction = () => Promise.resolve({ status: 'idle' });
const announced: (number | undefined)[] = [];

function onCartChanged(event: Event) {
  announced.push((event as CustomEvent<CartChangedDetail>).detail.count);
}

beforeEach(() => {
  announced.length = 0;
  window.addEventListener(CART_CHANGED_EVENT, onCartChanged);
});

afterEach(() => {
  window.removeEventListener(CART_CHANGED_EVENT, onCartChanged);
});

function renderLines(
  lines: CartLine[],
  { update = idleAction, remove = idleAction }: { update?: FormAction; remove?: FormAction } = {},
) {
  return render(
    <CartFormsProvider updateAction={update} removeAction={remove}>
      <ul>
        {lines.map((line) => (
          <CartLineItem key={line.productId} line={line} />
        ))}
      </ul>
    </CartFormsProvider>,
  );
}

function quantitySelect(name: string): HTMLSelectElement {
  const element = screen.getByLabelText(`Quantity for ${name}`);
  if (!(element instanceof HTMLSelectElement)) throw new Error('not a select');
  return element;
}

function optionValues(select: HTMLSelectElement): string[] {
  return Array.from(select.options, (option) => option.value);
}

describe('CartLineItem', () => {
  it('lays the line’s own picture over the tile', () => {
    const image = {
      url: 'https://media.nilzora.test/products/lamp/full.webp',
      thumbUrl: 'https://media.nilzora.test/products/lamp/thumb.webp',
      alt: 'A brass table lamp',
    };
    const { container } = renderLines([cartLine({ image })]);

    const picture = container.querySelector('img');
    expect(picture?.getAttribute('src')).toBe(image.thumbUrl);
    // Decorative: the product name right beside it is the description.
    expect(picture?.getAttribute('alt')).toBe('');
  });

  it('shows the branded tile for a line without a picture', () => {
    const { container } = renderLines([cartLine({ image: null })]);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Brass table lamp' })).not.toBeNull();
  });

  it('shows a line that can be ordered, with its API prices and controls', () => {
    const { container } = renderLines([cartLine()]);

    expect(screen.getByRole('heading', { name: 'Brass table lamp' })).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Brass table lamp' }).getAttribute('href')).toBe(
      '/products/brass-table-lamp',
    );
    expect(screen.getByText('৳1,250')).not.toBeNull();
    expect(screen.getByText('৳2,500').textContent).toBe('Line total: ৳2,500');
    const select = quantitySelect('Brass table lamp');
    expect(optionValues(select)).toEqual(['1', '2', '3', '4', '5']);
    expect(select.value).toBe('2');
    expect(
      screen.getByRole('button', { name: 'Update quantity for Brass table lamp' }),
    ).toHaveProperty('type', 'submit');
    expect(
      screen.getByRole('button', { name: 'Remove Brass table lamp from your cart' }),
    ).not.toBeNull();
    // Each form posts only the product id (and quantity): never a price.
    const names = Array.from(container.querySelectorAll('input, select'), (el) =>
      el.getAttribute('name'),
    );
    expect(names.sort()).toEqual(['productId', 'productId', 'quantity']);
    expect(container.querySelector('input[name="productId"]')?.getAttribute('value')).toBe(LAMP_ID);
  });

  it('names the chosen variant on its line, with that variant’s own price', () => {
    const variantId = 'ee000000-0000-4000-8000-000000000003';
    renderLines([
      cartLine({
        variantId,
        variantLabel: 'Size: M / Colour: Red',
        unitPriceMinor: 140_000,
        lineTotalMinor: 280_000,
      }),
    ]);

    expect(screen.getByText('Size: M / Colour: Red')).toBeDefined();
    expect(screen.getAllByText('৳1,400').length).toBeGreaterThan(0);
    const hidden = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="variantId"]'),
      (input) => input.value,
    );
    expect(hidden.length).toBeGreaterThan(0);
    expect(new Set(hidden)).toEqual(new Set([variantId]));
  });

  it('explains a stock problem and keeps the chosen quantity visible', () => {
    renderLines([cartLine({ quantity: 8, availableQuantity: 3, problem: 'insufficient_stock' })]);

    expect(screen.getByText('Only 3 left')).not.toBeNull();
    expect(optionValues(quantitySelect('Brass table lamp'))).toHaveLength(8);
    expect(quantitySelect('Brass table lamp').value).toBe('8');
    // Left out of the subtotal, so no line total either.
    expect(screen.queryByText(/Line total/)).toBeNull();
  });

  it('explains the per-order limit', () => {
    renderLines([cartLine({ quantity: 9, availableQuantity: 5, problem: 'quantity_limit' })]);
    expect(screen.getByText('At most 5 per order')).not.toBeNull();
  });

  it('shows a product that is no longer on sale without a link, price or quantity', () => {
    renderLines([
      cartLine({
        productId: MUG_ID,
        slug: null,
        name: null,
        sku: null,
        unitPriceMinor: null,
        compareAtPriceMinor: null,
        lineTotalMinor: null,
        availableQuantity: null,
        problem: 'unavailable',
      }),
    ]);

    expect(screen.getByRole('heading', { name: 'Product no longer available' })).not.toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('No longer available')).not.toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Remove Product no longer available from your cart' }),
    ).not.toBeNull();
  });

  it('offers only removal for a product that is out of stock', () => {
    renderLines([cartLine({ availableQuantity: 0, problem: 'insufficient_stock' })]);

    expect(screen.getByText('Out of stock')).not.toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Quantity: 2')).not.toBeNull();
  });
});

describe('cart line helpers', () => {
  it('links only slugs of the catalog shape', () => {
    expect(productHref('brass-table-lamp')).toBe('/products/brass-table-lamp');
    expect(productHref('../../admin')).toBeNull();
    expect(productHref('Lamp?x=1')).toBeNull();
    expect(productHref('//evil.example')).toBeNull();
    expect(productHref(null)).toBeNull();
  });

  it('describes every problem in plain words', () => {
    expect(cartLineProblemText({ problem: null, availableQuantity: 5 })).toBeNull();
    expect(cartLineProblemText({ problem: 'unavailable', availableQuantity: null })).toBe(
      'No longer available',
    );
    expect(cartLineProblemText({ problem: 'insufficient_stock', availableQuantity: 1 })).toBe(
      'Only 1 left',
    );
    expect(cartLineProblemText({ problem: 'quantity_limit', availableQuantity: 0 })).toBe(
      'Out of stock',
    );
  });
});

describe('cart line forms', () => {
  it('updates a quantity, reports it and tells the header the new count', async () => {
    const update = vi.fn<FormAction>(() =>
      Promise.resolve({ status: 'success', message: 'Cart updated.', values: { count: '4' } }),
    );
    renderLines([cartLine()], { update });

    fireEvent.change(quantitySelect('Brass table lamp'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update quantity for Brass table lamp' }));

    expect(await screen.findByText('Cart updated.')).not.toBeNull();
    const submitted = update.mock.calls[0]?.[1];
    expect(submitted?.get('productId')).toBe(LAMP_ID);
    expect(submitted?.get('quantity')).toBe('4');
    // The announcement comes from an effect, which may run just after the message shows.
    await waitFor(() => expect(announced).toEqual([4]));
  });

  it('shows a refused update as an alert and announces nothing', async () => {
    const update = vi.fn<FormAction>(() =>
      Promise.resolve({ status: 'error', message: 'Choose a quantity from the list.' }),
    );
    renderLines([cartLine()], { update });

    fireEvent.click(screen.getByRole('button', { name: 'Update quantity for Brass table lamp' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Choose a quantity from the list.');
    expect(announced).toEqual([]);
  });

  it('removes a line, reporting it above the list where focus moves', async () => {
    const remove = vi.fn<FormAction>((): Promise<FormState> =>
      Promise.resolve({
        status: 'success',
        message: 'Removed from your cart.',
        values: { count: '1' },
      }),
    );
    renderLines([cartLine(), cartLine({ productId: MUG_ID, name: 'Ceramic mug', slug: 'mug' })], {
      remove,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Ceramic mug from your cart' }));

    const message = await screen.findByRole('status', { name: '' });
    expect(message.textContent).toContain('Removed from your cart.');
    expect(remove.mock.calls[0]?.[1].get('productId')).toBe(MUG_ID);
    await waitFor(() => expect(document.activeElement?.contains(message)).toBe(true));
    expect(announced).toEqual([1]);
  });
});

describe('CartSummary', () => {
  it('shows the subtotal and leads to checkout', () => {
    render(<CartSummary quote={cartQuote({ itemCount: 3, subtotalMinor: 310_000 })} />);

    const summary = screen.getByRole('definition');
    expect(summary.textContent).toBe('৳3,100');
    expect(screen.getByText('Subtotal (3 items)')).not.toBeNull();
    expect(screen.getByText('Delivery charge calculated at checkout')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Proceed to checkout' }).getAttribute('href')).toBe(
      '/checkout',
    );
    expect(screen.getByText('Cash on Delivery — pay when your parcel arrives')).not.toBeNull();
  });

  it('explains why checkout is not possible yet', () => {
    render(
      <CartSummary
        quote={cartQuote({
          purchasable: false,
          lines: [cartLine({ problem: 'insufficient_stock', availableQuantity: 1 })],
          itemCount: 0,
          subtotalMinor: 0,
        })}
      />,
    );

    expect(screen.queryByRole('link', { name: 'Proceed to checkout' })).toBeNull();
    const button = screen.getByRole('button', { name: 'Proceed to checkout' });
    expect(button).toHaveProperty('disabled', true);
    const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toContain('Some items need attention');
    expect(within(screen.getByRole('definition')).getByText('৳0')).not.toBeNull();
  });
});
