'use client';

import { Button } from '@nilzora/ui';
import { Printer } from 'lucide-react';
import { AutoText } from '@/components/i18n/translate';

/**
 * Opens the browser's print dialog. The order page carries print styles (see
 * app/globals.css), so the printed sheet is the invoice: workspace chrome, filters and
 * action buttons drop away and the panels print flat on white.
 */
export function PrintOrderButton({ className }: { className?: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        window.print();
      }}
      className={`h-9 rounded-xl max-sm:h-11 ${className ?? ''}`}
    >
      <Printer aria-hidden="true" strokeWidth={1.75} />
      <AutoText>Print</AutoText>
    </Button>
  );
}
