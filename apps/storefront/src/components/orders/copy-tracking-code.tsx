'use client';

import { buttonClasses, copyToClipboard } from '@nilzora/ui';
import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

type Outcome = 'idle' | 'copied' | 'failed';

/** Copies a courier tracking code, and says so (visibly and to screen readers). */
export function CopyTrackingCode({ code }: { code: string }) {
  const [outcome, setOutcome] = useState<Outcome>('idle');

  useEffect(() => {
    if (outcome !== 'copied') return;
    const timer = window.setTimeout(() => setOutcome('idle'), 2500);
    return () => window.clearTimeout(timer);
  }, [outcome]);

  async function copy() {
    setOutcome((await copyToClipboard(code)) ? 'copied' : 'failed');
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy tracking code ${code}`}
        className={buttonClasses({ variant: 'outline', size: 'sm' })}
      >
        {outcome === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {outcome === 'copied' ? 'Copied' : 'Copy'}
      </button>
      <span
        role="status"
        aria-live="polite"
        className={outcome === 'failed' ? 'text-xs text-muted-foreground' : 'sr-only'}
      >
        {outcome === 'copied'
          ? 'Tracking code copied.'
          : outcome === 'failed'
            ? 'Copying is blocked here. Select the code instead.'
            : ''}
      </span>
    </div>
  );
}
