'use client';

import type { ChatConversationDetail } from '@nilzora/contracts';
import { Star, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface Invite {
  productId: string;
  productName: string;
  orderNumber: string;
}

/*
 * A review invitation inside a support thread
 * -------------------------------------------
 * Only in a thread about one of the customer's own orders, only once that order is delivered,
 * and only for a product the API lists as delivered and not yet reviewed by this account (read
 * through this app's /api/support route). The link goes to the order page, where each delivered
 * item has its own review form. A failed read shows nothing.
 */
export function SupportReviewInvite({ detail }: { detail: ChatConversationDetail | null }) {
  const order = detail?.order ?? null;
  const productId = detail?.product?.id ?? null;
  const delivered = order !== null && order.status === 'delivered';
  const orderNumber = order?.number ?? null;
  const [invite, setInvite] = useState<Invite | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!delivered || orderNumber === null) return;
    let alive = true;
    const query = new URLSearchParams({ op: 'review-invite', order: orderNumber });
    if (productId !== null) query.set('product', productId);
    void fetch(`/api/support?${query.toString()}`, { cache: 'no-store' })
      .then(async (response) =>
        response.ok ? ((await response.json()) as { item: Invite | null }) : null,
      )
      .then((payload) => {
        if (alive) setInvite(payload?.item ?? null);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [delivered, orderNumber, productId]);

  if (!delivered || hidden || invite === null) return null;
  return (
    <div
      data-testid="support-review-invite"
      className="mx-3 mt-2 flex items-center gap-2.5 rounded-xl border border-border bg-background px-3 py-2"
    >
      <Star aria-hidden className="size-4 shrink-0 fill-amber-500 text-amber-500" />
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        <span className="block truncate font-semibold text-foreground">
          How was {invite.productName}?
        </span>
        Order {invite.orderNumber} was delivered.
      </p>
      <Link
        href={`/account/orders/${encodeURIComponent(invite.orderNumber)}`}
        className="inline-flex min-h-9 shrink-0 items-center rounded-full border border-border px-3 text-xs font-semibold text-foreground transition hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Write a review
      </Link>
      <button
        type="button"
        aria-label="Hide the review invitation"
        onClick={() => setHidden(true)}
        className="grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
