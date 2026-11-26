import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReceiptActions } from './receipt-actions';

/*
 * What a customer can do with a receipt on the website: print it, download the PDF, copy it as
 * text, share it. Each action is checked for what it actually does — a download is a link to
 * the authenticated PDF route, and copying never downloads or uploads anything.
 */

const RECEIPT_TEXT = 'Nilzora\nOrder receipt — NZ100042\nTotal: BDT 1,900';
const SHARE_TEXT = 'Nilzora\nOrder receipt — NZ100042\nTotal: BDT 1,900\nShared from a receipt.';

function redirect() {
  const anchor = screen.getByRole('link', { name: 'Download PDF' });
  return { href: anchor.getAttribute('href'), download: anchor.getAttribute('download') };
}

function stubClipboard(writeText = vi.fn(() => Promise.resolve())) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

function withoutShare() {
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
}

function actions() {
  return render(
    <ReceiptActions
      orderNumber="NZ100042"
      pdfHref="/account/orders/NZ100042/receipt/pdf"
      receiptText={RECEIPT_TEXT}
      shareText={SHARE_TEXT}
    />,
  );
}

describe('ReceiptActions', () => {
  it('prints the receipt with the browser print dialog', () => {
    withoutShare();
    stubClipboard();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    actions();

    fireEvent.click(screen.getByRole('button', { name: 'Print receipt' }));

    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it('downloads the PDF from the authenticated route, under a recognisable name', () => {
    withoutShare();
    actions();

    // A plain link: the browser downloads it, so no script has to hold the document.
    expect(redirect()).toEqual({ href: '/account/orders/NZ100042/receipt/pdf', download: '' });
  });

  it('copies the whole receipt as text, without producing a file', async () => {
    withoutShare();
    const writeText = stubClipboard();
    actions();

    fireEvent.click(screen.getByRole('button', { name: 'Copy receipt' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(RECEIPT_TEXT);
    });
    expect(await screen.findByText('Receipt copied.')).not.toBeNull();
    // Nothing was generated or downloaded by copying.
    expect(redirect().href).toBe('/account/orders/NZ100042/receipt/pdf');
  });

  it('shares only the text that carries no personal details', async () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    actions();

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => {
      expect(share).toHaveBeenCalledWith({ title: 'Nilzora receipt NZ100042', text: SHARE_TEXT });
    });
    expect(await screen.findByText('Receipt shared.')).not.toBeNull();
  });

  it('falls back to copying the shareable text where there is no share sheet', async () => {
    withoutShare();
    const writeText = stubClipboard();
    actions();

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(SHARE_TEXT);
    });
    expect(await screen.findByText('Receipt copied.')).not.toBeNull();
  });

  it('says so when the browser blocks copying', async () => {
    withoutShare();
    stubClipboard(vi.fn(() => Promise.reject(new Error('blocked'))));
    actions();

    fireEvent.click(screen.getByRole('button', { name: 'Copy receipt' }));

    expect(
      await screen.findByText('Copying is blocked in this browser. You can download the PDF.'),
    ).not.toBeNull();
  });

  it('treats a cancelled share sheet as nothing to report', async () => {
    const cancelled = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const share = vi.fn(() => Promise.reject(cancelled));
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    actions();

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() => {
      expect(share).toHaveBeenCalled();
    });
    expect(screen.queryByText(/could not be shared/)).toBeNull();
    expect(screen.queryByText('Receipt shared.')).toBeNull();
  });
});
