'use client';

import { Button, buttonClasses, copyToClipboard, runShare } from '@nilzora/ui';
import { Copy, Download, Printer, Share2 } from 'lucide-react';
import { useState } from 'react';

/*
 * What a customer can do with a receipt.
 *
 * Download fetches the API's own PDF through this app's authenticated route, so the file and
 * the page are built from the same order fields. Print uses the browser's print dialog against
 * the `.nz-print-area` stylesheet, so the sheet holds the receipt and nothing else. Copy takes
 * the whole receipt as text, the form to paste into a message or a note. Share uses the
 * platform share sheet where one exists, and its text never carries the customer's name,
 * phone number or address, so forwarding a receipt cannot leak where they live.
 */

type Note = { kind: 'done' | 'error'; text: string } | null;

export interface ReceiptActionsProps {
  orderNumber: string;
  /** The authenticated PDF route for this order. */
  pdfHref: string;
  /** The receipt as plain text, built from the order by the shared receipt module. */
  receiptText: string;
  /** The same receipt without the customer's own contact details, for sharing. */
  shareText: string;
}

export function ReceiptActions({
  orderNumber,
  pdfHref,
  receiptText,
  shareText,
}: ReceiptActionsProps) {
  const [note, setNote] = useState<Note>(null);

  async function share() {
    // One shared implementation for the whole monorepo: the platform sheet where there is one,
    // the clipboard where there is not, and a cancelled sheet reported as nothing at all.
    const outcome = await runShare({
      title: `Nilzora receipt ${orderNumber}`,
      text: shareText,
    });
    if (outcome === 'cancelled') return;
    if (outcome === 'failed') {
      setNote({
        kind: 'error',
        text: 'The receipt could not be shared. You can copy it or download the PDF instead.',
      });
      return;
    }
    setNote({ kind: 'done', text: outcome === 'shared' ? 'Receipt shared.' : 'Receipt copied.' });
  }

  async function copyReceipt() {
    setNote(
      (await copyToClipboard(receiptText))
        ? { kind: 'done', text: 'Receipt copied.' }
        : { kind: 'error', text: 'Copying is blocked in this browser. You can download the PDF.' },
    );
  }

  return (
    <div className="nz-no-print grid gap-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => window.print()}>
          <Printer aria-hidden="true" />
          Print receipt
        </Button>
        <a href={pdfHref} download className={buttonClasses({ variant: 'secondary' })}>
          <Download aria-hidden="true" />
          Download PDF
        </a>
        <Button variant="outline" onClick={() => void copyReceipt()}>
          <Copy aria-hidden="true" />
          Copy receipt
        </Button>
        <Button variant="outline" onClick={() => void share()}>
          <Share2 aria-hidden="true" />
          Share
        </Button>
      </div>
      <p
        role="status"
        aria-live="polite"
        className={
          note === null
            ? 'sr-only'
            : note.kind === 'error'
              ? 'text-sm text-danger'
              : 'text-sm text-success'
        }
      >
        {note?.text ?? ''}
      </p>
    </div>
  );
}
