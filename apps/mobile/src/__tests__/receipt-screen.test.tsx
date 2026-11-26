import type { OrderDetail } from '@nilzora/contracts';
import { ApiError } from '@nilzora/api-client';
import { screen, userEvent } from '@testing-library/react-native';
import { Share } from 'react-native';
import { ReceiptScreen } from '../features/receipt/receipt-screen';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

/* The clipboard is a native module: the screen is tested against this stand-in for it. */
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

/* The folder picker is native: the screen is tested against this stand-in for it. */
jest.mock('@/features/receipt/save-receipt', () => ({
  CAN_SAVE_RECEIPT: true,
  saveReceiptPdf: jest.fn(),
}));

const clipboard = jest.requireMock<{
  setStringAsync: jest.Mock<Promise<boolean>, [string]>;
}>('expo-clipboard');
const saving = jest.requireMock<{ saveReceiptPdf: jest.Mock }>('@/features/receipt/save-receipt');

function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    orderNumber: 'NZ100042',
    status: 'pending',
    paymentMethod: 'cod',
    paymentStatus: 'pending',
    itemCount: 1,
    totalMinor: 159000,
    placedAt: '2026-11-06T04:30:00.000Z',
    preview: [],
    currency: 'BDT',
    subtotalMinor: 150000,
    shippingFeeMinor: 9000,
    discountMinor: 0,
    deliveryZone: 'inside_dhaka',
    shippingAddress: {
      recipientName: 'Ayesha Rahman',
      phone: '+8801712345678',
      division: 'Dhaka',
      district: 'Dhaka',
      area: 'Dhanmondi',
      addressLine: 'House 12, Road 5',
      postalCode: null,
      landmark: null,
    },
    customerNote: null,
    cancelReason: null,
    cancelledAt: null,
    items: [
      {
        orderItemId: 1,
        productId: '11111111-1111-4111-8111-111111111111',
        variantId: null,
        variantLabel: 'Size: M',
        productName: 'Cotton panjabi',
        productSlug: 'cotton-panjabi',
        sku: 'NZ-PAN-01',
        unitPriceMinor: 150000,
        regularPriceMinor: null,
        catalogPriceMinor: null,
        campaignId: null,
        campaignTitle: null,
        campaignDiscountMinor: 0,
        image: null,
        quantity: 1,
        lineTotalMinor: 150000,
      },
    ],
    history: [],
    canCancel: true,
    ...overrides,
  };
}

async function showOrder(value: OrderDetail = order()) {
  const api = createFakeApiClient();
  api.getOrder.mockResolvedValue({ order: value });
  api.orderReceiptPdf.mockResolvedValue({
    bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    fileName: `Nilzora-Receipt-${value.orderNumber}.pdf`,
    contentType: 'application/pdf',
  });
  const harness = await renderWithProviders(<ReceiptScreen orderNumber={value.orderNumber} />, {
    api,
  });
  return { ...harness, api };
}

beforeEach(() => {
  clipboard.setStringAsync.mockReset();
  clipboard.setStringAsync.mockResolvedValue(true);
  saving.saveReceiptPdf.mockReset();
  saving.saveReceiptPdf.mockResolvedValue('saved');
});

describe('ReceiptScreen', () => {
  it('reads the order from the API and shows it as a cash-on-delivery receipt', async () => {
    const { api } = await showOrder();

    expect(await screen.findByText('Order NZ100042')).toBeOnTheScreen();
    expect(api.getOrder).toHaveBeenCalledWith(expect.anything(), 'NZ100042', expect.anything());
    expect(screen.getByText('Cash on Delivery')).toBeOnTheScreen();
    expect(screen.getByText('Payment pending')).toBeOnTheScreen();
    // A placed COD order is not a paid order.
    expect(screen.queryByText('Paid')).not.toBeOnTheScreen();
    expect(screen.getByText('Cotton panjabi')).toBeOnTheScreen();
    expect(screen.getByText('Size: M')).toBeOnTheScreen();
  });

  it('offers the receipt actions a phone can perform', async () => {
    await showOrder();

    await screen.findByText('Order NZ100042');
    expect(screen.getByRole('button', { name: 'Save PDF' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Copy receipt' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Share receipt' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Order details' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Continue shopping' })).toBeOnTheScreen();
  });

  it('downloads the API PDF into the folder the customer picks', async () => {
    const user = userEvent.setup();
    const { api } = await showOrder();
    await screen.findByText('Order NZ100042');

    await user.press(screen.getByRole('button', { name: 'Save PDF' }));

    expect(api.orderReceiptPdf).toHaveBeenCalledWith(expect.anything(), 'NZ100042');
    expect(saving.saveReceiptPdf).toHaveBeenCalledWith(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      'Nilzora-Receipt-NZ100042.pdf',
    );
    expect(await screen.findByText('Receipt saved.')).toBeOnTheScreen();
  });

  it('says so when the receipt cannot be saved on the device', async () => {
    const user = userEvent.setup();
    saving.saveReceiptPdf.mockResolvedValue('failed');
    await showOrder();
    await screen.findByText('Order NZ100042');

    await user.press(screen.getByRole('button', { name: 'Save PDF' }));

    expect(
      await screen.findByText('The receipt could not be saved on this device.'),
    ).toBeOnTheScreen();
  });

  it('copies the whole receipt as plain English text, and shares only what is safe to share', async () => {
    const user = userEvent.setup();
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await showOrder();
    await screen.findByText('Order NZ100042');

    await user.press(screen.getByRole('button', { name: 'Copy receipt' }));
    const copied = String(clipboard.setStringAsync.mock.calls[0]?.[0]);
    // The customer's own copy carries the delivery details.
    expect(copied).toContain('Ayesha Rahman');
    expect(copied).toContain('+8801712345678');
    expect(copied).toContain('Total: BDT 1,590');
    // English only: no currency glyph, and nothing that only exists in a file.
    expect(copied).not.toContain('৳');
    expect(await screen.findByText('Receipt copied.')).toBeOnTheScreen();
    // Copying is text: no document is produced and no folder picker opens.
    expect(saving.saveReceiptPdf).not.toHaveBeenCalled();

    await user.press(screen.getByRole('button', { name: 'Share receipt' }));
    const shared = String((share.mock.calls[0]?.[0] as { message?: string }).message);
    // What leaves the phone never carries where the customer lives.
    expect(shared).toContain('Cotton panjabi');
    expect(shared).toContain('BDT');
    expect(shared).not.toContain('Ayesha Rahman');
    expect(shared).not.toContain('+8801712345678');
    expect(shared).not.toContain('House 12');
  });

  it('says so when the device refuses the copy', async () => {
    const user = userEvent.setup();
    clipboard.setStringAsync.mockRejectedValue(new Error('denied'));
    await showOrder();
    await screen.findByText('Order NZ100042');

    await user.press(screen.getByRole('button', { name: 'Copy receipt' }));

    expect(
      await screen.findByText('The receipt could not be copied. You can save the PDF instead.'),
    ).toBeOnTheScreen();
  });

  it('shows a collected order as paid, with nothing left to pay', async () => {
    await showOrder(order({ status: 'delivered', paymentStatus: 'collected', canCancel: false }));

    await screen.findByText('Order NZ100042');
    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
    expect(screen.getByText('Nothing')).toBeOnTheScreen();
    expect(screen.getByText('Paid in cash when this order was delivered.')).toBeOnTheScreen();
  });

  it('shows a pending order with the full amount still due', async () => {
    await showOrder();

    await screen.findByText('Order NZ100042');
    expect(screen.getByText('Due')).toBeOnTheScreen();
    expect(screen.queryByText('Nothing')).not.toBeOnTheScreen();
  });

  it("answers not found for another customer's order", async () => {
    const api = createFakeApiClient();
    api.getOrder.mockRejectedValue(new ApiError(404, 'not_found', 'missing'));
    await renderWithProviders(<ReceiptScreen orderNumber="NZ100099" />, { api });

    expect(await screen.findByText('Receipt not found')).toBeOnTheScreen();
  });
});
