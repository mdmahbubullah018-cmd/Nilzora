// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ChatConversationDetail } from '@nilzora/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextPanel } from './context-panel';

/*
 * The panel beside the thread. What matters here is that an agent can see which product of
 * which order the conversation is about — with the picture kept with the line — without
 * opening the order, and that a thread with no context shows no context section.
 */

function detail(overrides: Partial<ChatConversationDetail> = {}): ChatConversationDetail {
  return {
    conversation: {
      id: '00000000-0000-4000-8000-0000000000c1',
      kind: 'order_support',
      status: 'open',
      priority: 'normal',
      subject: 'Where is my order?',
      customerId: '00000000-0000-4000-8000-0000000000b1',
      orderId: null,
      productId: null,
      assigneeId: null,
      lastMessageAt: '2026-11-05T10:00:00.000Z',
      lastMessagePreview: 'Hello',
      lastMessageSenderId: null,
      messageCount: 1,
      createdAt: '2026-11-05T09:00:00.000Z',
      updatedAt: '2026-11-05T10:00:00.000Z',
      resolvedAt: null,
      closedAt: null,
    },
    viewer: {
      userId: '00000000-0000-4000-8000-0000000000a1',
      role: 'staff',
      lastReadSeq: 0,
      isAssignee: true,
      canReply: true,
      canAssign: true,
      canUseInternalNotes: true,
    },
    customer: null,
    order: null,
    product: null,
    participants: [],
    ...overrides,
  };
}

function panel(value: ChatConversationDetail) {
  return render(
    <ContextPanel
      detail={value}
      permissions={new Set(['orders.read', 'products.read'])}
      feedback={[]}
      tags={[]}
      tagsBusy={false}
      onTags={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('ContextPanel', () => {
  afterEach(cleanup);

  it('lists the order lines with the variant and the picture kept with each line', () => {
    panel(
      detail({
        order: {
          id: '00000000-0000-4000-8000-0000000000e1',
          number: 'NZ100042',
          status: 'shipped',
          paymentStatus: 'pending',
          totalMinor: 250_000,
          itemCount: 2,
          placedAt: '2026-11-05T09:00:00.000Z',
          items: [
            {
              productId: '00000000-0000-4000-8000-0000000000f1',
              name: 'Cotton panjabi',
              variantLabel: 'Size: M',
              quantity: 1,
              image: {
                url: 'https://media.example.com/products/p/1/full.webp',
                thumbUrl: 'https://media.example.com/products/p/1/thumb.webp',
                alt: null,
              },
            },
            {
              productId: '00000000-0000-4000-8000-0000000000f2',
              name: 'Cotton handkerchief',
              variantLabel: null,
              quantity: 2,
              image: null,
            },
          ],
        },
        product: {
          id: '00000000-0000-4000-8000-0000000000f1',
          slug: 'cotton-panjabi',
          name: 'Cotton panjabi',
          priceMinor: 150_000,
          status: 'active',
          image: null,
          variantLabel: 'Size: M',
        },
      }),
    );

    expect(screen.getByText('Cotton handkerchief')).not.toBeNull();
    expect(screen.getAllByText('Size: M · × 1').length).toBeGreaterThan(0);
    // Both the order line and the product section show the product name.
    expect(screen.getAllByText('Cotton panjabi').length).toBeGreaterThan(1);
    const pictures = [...document.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(pictures).toContain('https://media.example.com/products/p/1/thumb.webp');
  });

  it('has no order or product section for a thread without context', () => {
    panel(detail());

    expect(screen.queryByText('Order')).toBeNull();
    expect(screen.queryByText('Product')).toBeNull();
  });
});
