'use client';

import { buttonClasses, LogoMark } from '@nilzora/ui';
import Link from 'next/link';
import './globals.css';
import { AutoText } from '@/components/i18n/translate';

/**
 * Replaces the root layout when it fails, so it brings its own document, styles and
 * (light) theme. Shows only the server's error reference, never the message or stack.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en" data-theme="light">
      <body className="min-h-dvh antialiased" suppressHydrationWarning>
        <title>
          <AutoText>Something went wrong · Nilzora Admin</AutoText>
        </title>
        <main className="grid min-h-dvh place-items-center bg-surface-muted px-4">
          <div className="grid max-w-md justify-items-center gap-4 text-center">
            <LogoMark decorative />
            <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
              <AutoText>Nilzora could not be loaded</AutoText>
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Something went wrong on our side. Try again, and if it keeps happening, let an admin
              know.
            </p>
            {error.digest ? (
              <p className="text-xs text-muted-foreground">
                Reference: <code className="font-mono">{error.digest}</code>
              </p>
            ) : null}
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" onClick={retry} className={buttonClasses()}>
                <AutoText>Try again</AutoText>
              </button>
              <Link href="/" className={buttonClasses({ variant: 'outline' })}>
                <AutoText>Go to your workspace</AutoText>
              </Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
