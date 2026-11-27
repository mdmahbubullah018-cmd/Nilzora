import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { CSRF_FIELD } from '@nilzora/web-session';
import { readAccount } from '@/lib/account-read';
import { session } from '@/lib/session';
import { RecoveryRestoreForm } from '@/components/recovery-restore-form';

export const metadata: Metadata = {
  title: 'Restore your cart',
  robots: { index: false, follow: false },
};

const tokenSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{64}$/i);

const REASONS: Record<string, string> = {
  not_found: 'This link is not one Nilzora issued.',
  revoked: 'A newer link replaced this one. Use the newest message from Nilzora.',
  used: 'This link has already been used.',
  expired: 'This link has expired.',
  closed: 'That checkout is already an order, or it is too old to restore.',
};

/**
 * The landing page of a recovery link.
 *
 * Only the signed-in owner of the checkout can restore it, so this is a signed-in route: a
 * visitor who is not signed in signs in first. What the link reveals is a count and a value —
 * never a name, a phone number or a product list.
 */
export default async function RecoverCartPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!tokenSchema.safeParse(token).success) {
    return (
      <Shell
        title="This link is not valid."
        body="Check the message you received and try the newest link."
      />
    );
  }

  const preview = await readAccount((api) => api.previewCheckoutRecovery(token));
  if (preview.kind === 'signed_out') {
    return (
      <Shell
        title="Sign in to restore your cart"
        body="The cart in this link belongs to your Nilzora account, so sign in and open the link again."
      />
    );
  }
  if (preview.kind !== 'ok') {
    return (
      <Shell
        title="We could not check this link"
        body="Nilzora could not be reached just now. Reload the page in a moment."
      />
    );
  }
  if (!preview.value.valid) {
    return (
      <Shell
        title="This link no longer works"
        body={REASONS[preview.value.reason ?? 'expired'] ?? 'This link has expired.'}
      />
    );
  }

  const items = preview.value.itemCount;
  const value = Math.round(preview.value.cartValueMinor / 100);
  return (
    <Shell
      title="Your cart is still here"
      body={`${String(items)} ${items === 1 ? 'item is' : 'items are'} waiting in the cart you left, worth about ৳${String(value)}. Restoring puts those lines back in your cart; prices and stock are checked again at checkout.`}
    >
      <RecoveryRestoreForm
        token={token}
        csrf={{ name: CSRF_FIELD, token: await session.csrfToken() }}
      />
      <p className="text-xs text-muted-foreground">
        This link works once, and only for the account that owns the cart.
      </p>
    </Shell>
  );
}

function Shell({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="mx-auto grid min-h-[70vh] w-full max-w-xl place-content-center gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      <p className="text-sm text-muted-foreground">{body}</p>
      {children}
      <Link href="/" className="text-sm font-semibold text-link underline-offset-4 hover:underline">
        Back to the shop
      </Link>
    </main>
  );
}
