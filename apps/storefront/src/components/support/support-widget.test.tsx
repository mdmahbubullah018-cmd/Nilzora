import type {
  ChatConversationDetail,
  ChatConversationSummary,
  ChatMessage,
} from '@nilzora/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSupport } from '@/lib/support-events';
import { SupportWidget } from './support-widget';

/*
 * The customer chat widget. The API is stubbed at `fetch`, which is the whole browser
 * boundary: everything the widget can reach goes through this app's `/api/support` route,
 * and the browser never holds a token. The ticket request fails by default here, so the
 * widget is also exercised on its no-realtime path - the one a shopper on a poor
 * connection gets.
 */

const fetchMock = vi.fn<typeof fetch>();

const CONVERSATION_ID = '44444444-4444-4444-8444-444444444444';
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function summary(overrides: Partial<ChatConversationSummary> = {}): ChatConversationSummary {
  return {
    id: CONVERSATION_ID,
    kind: 'customer_support',
    status: 'open',
    priority: 'normal',
    subject: 'Delivery to Sylhet',
    customerId: CUSTOMER_ID,
    customerName: 'Customer One',
    customerEmail: 'one@example.com',
    orderId: null,
    orderNumber: null,
    productId: null,
    productName: null,
    assigneeId: null,
    assigneeName: null,
    lastMessageAt: '2026-11-03T10:00:00.000Z',
    lastMessagePreview: 'How long does delivery take?',
    lastMessageSenderId: null,
    messageCount: 1,
    unreadCount: 2,
    latestSeq: 1,
    createdAt: '2026-11-03T10:00:00.000Z',
    updatedAt: '2026-11-03T10:00:00.000Z',
    ...overrides,
  };
}

function detail(overrides: Partial<ChatConversationDetail> = {}): ChatConversationDetail {
  return {
    conversation: {
      ...summary(),
      resolvedAt: null,
      closedAt: null,
    },
    viewer: {
      userId: CUSTOMER_ID,
      role: 'customer',
      lastReadSeq: 0,
      isAssignee: false,
      canReply: true,
      canAssign: false,
      canUseInternalNotes: false,
    },
    customer: null,
    order: null,
    product: null,
    participants: [],
    ...overrides,
  };
}

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    seq: 1,
    senderId: null,
    senderRole: 'staff',
    senderName: 'Staff One',
    kind: 'text',
    body: 'Two days to Sylhet.',
    replyToId: null,
    metadata: {},
    editedAt: null,
    createdAt: '2026-11-03T10:05:00.000Z',
    attachments: [],
    ...overrides,
  };
}

/** Routes the widget's calls by operation, so a test states only what it cares about. */
function route(handlers: {
  list?: () => Promise<Response>;
  thread?: () => Promise<Response>;
  messages?: () => Promise<Response>;
  send?: () => Promise<Response>;
  post?: () => Promise<Response>;
  upload?: () => Promise<Response>;
  ticket?: () => Promise<Response>;
}): void {
  fetchMock.mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};

    if (url.includes('/api/support/attachments')) {
      return handlers.upload?.() ?? json({ error: { code: 'x', message: 'no upload' } }, 500);
    }
    if (url.includes('op=ticket')) {
      return (
        handlers.ticket?.() ??
        json({ error: { code: 'realtime_unavailable', message: 'off' } }, 503)
      );
    }
    if (url.includes('op=thread')) return handlers.thread?.() ?? json(detail());
    if (url.includes('op=messages')) {
      return handlers.messages?.() ?? json({ messages: [], nextCursor: null });
    }
    if (method === 'POST' && body.op === 'send') {
      return (
        handlers.send?.() ??
        json(
          {
            message: message({ senderRole: 'customer', body: 'Thank you' }),
            duplicate: false,
            unread: 0,
          },
          201,
        )
      );
    }
    if (method === 'POST' && body.op === 'read') return json({ unread: 0 });
    if (method === 'POST' && body.op === 'post') {
      return (
        handlers.post?.() ??
        json(
          {
            message: message({ senderRole: 'customer', body: 'Sent', seq: 9 }),
            duplicate: false,
            unreadCount: 0,
            attachments: [],
          },
          201,
        )
      );
    }
    if (url.includes('op=list')) {
      return (
        handlers.list?.() ??
        json({
          conversations: [summary()],
          unread: 2,
          page: 1,
          pageSize: 20,
          total: 1,
          totalPages: 1,
        })
      );
    }
    return json({}, 404);
  });
}

function launcher(): HTMLElement {
  return screen.getByRole('button', { name: /support chat/i });
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  // jsdom does not always expose randomUUID; the widget only needs an id-shaped string.
  vi.stubGlobal('crypto', { randomUUID: () => '66666666-6666-4666-8666-666666666666' });
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('SupportWidget', () => {
  it('shows a launcher and loads the conversations when opened', async () => {
    route({});
    render(<SupportWidget />);

    expect(launcher().getAttribute('aria-label')).toBe('Open support chat');
    fireEvent.click(launcher());

    expect(await screen.findByText('Delivery to Sylhet')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Customer support chat' })).toBeTruthy();
  });

  it('opens on a conversation when a page asks for one', async () => {
    route({ messages: () => json({ messages: [message()], nextCursor: null }) });
    render(<SupportWidget />);

    openSupport({ conversationId: CONVERSATION_ID });

    expect(await screen.findByText('Two days to Sylhet.')).toBeTruthy();
  });

  it('keeps the product and order of the open thread pinned above the messages', async () => {
    route({
      thread: () =>
        json(
          detail({
            order: {
              id: '99999999-9999-4999-8999-999999999999',
              number: 'NZ100042',
              status: 'shipped',
              paymentStatus: 'pending',
              totalMinor: 250_000,
              itemCount: 2,
              placedAt: '2026-11-03T09:00:00.000Z',
              items: [
                {
                  productId: '44444444-4444-4444-8444-444444444444',
                  name: 'Cotton panjabi',
                  variantLabel: 'Size: M',
                  quantity: 1,
                  image: null,
                },
                {
                  productId: '44444444-4444-4444-8444-444444444445',
                  name: 'Cotton handkerchief',
                  variantLabel: null,
                  quantity: 2,
                  image: null,
                },
              ],
            },
            product: {
              id: '44444444-4444-4444-8444-444444444444',
              slug: 'cotton-panjabi',
              name: 'Cotton panjabi',
              priceMinor: 150_000,
              status: 'active',
              image: {
                url: 'https://media.example.com/products/p/1/full.webp',
                thumbUrl: 'https://media.example.com/products/p/1/thumb.webp',
                alt: null,
              },
              variantLabel: 'Size: M',
            },
          }),
        ),
      messages: () => json({ messages: [message()], nextCursor: null }),
    });
    render(<SupportWidget />);

    openSupport({ conversationId: CONVERSATION_ID });

    // The product, the variant that was bought and the order it came from, in one row.
    expect(await screen.findByText('Size: M · Order NZ100042')).toBeTruthy();
    expect(screen.getByText('Cotton panjabi')).toBeTruthy();
    const pictures = [...document.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(pictures).toContain('https://media.example.com/products/p/1/thumb.webp');
    expect(screen.getAllByRole('link', { name: 'View' })[0]?.getAttribute('href')).toBe(
      '/products/cotton-panjabi',
    );
  });

  it('replaces the pinned context when another conversation is opened', async () => {
    let opened = 0;
    route({
      thread: () => {
        opened += 1;
        return json(
          opened === 1
            ? detail({
                product: {
                  id: '44444444-4444-4444-8444-444444444441',
                  slug: 'first-product',
                  name: 'First product',
                  priceMinor: 10_000,
                  status: 'active',
                  image: null,
                  variantLabel: null,
                },
              })
            : detail({
                product: {
                  id: '44444444-4444-4444-8444-444444444442',
                  slug: 'second-product',
                  name: 'Second product',
                  priceMinor: 20_000,
                  status: 'active',
                  image: null,
                  variantLabel: null,
                },
              }),
        );
      },
      messages: () => json({ messages: [message()], nextCursor: null }),
    });
    render(<SupportWidget />);

    openSupport({ conversationId: CONVERSATION_ID });
    expect(await screen.findByText('First product')).toBeTruthy();

    openSupport({ conversationId: '99999999-9999-4999-8999-999999999998' });

    expect(await screen.findByText('Second product')).toBeTruthy();
    // The previous conversation's product is gone, not left behind above the new thread.
    expect(screen.queryByText('First product')).toBeNull();
  });

  it('has no context row for a thread that is about nothing in particular', async () => {
    route({ messages: () => json({ messages: [message()], nextCursor: null }) });
    render(<SupportWidget />);

    openSupport({ conversationId: CONVERSATION_ID });

    expect(await screen.findByText('Two days to Sylhet.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'View' })).toBeNull();
  });

  it('shows the pictures and files a message carries', async () => {
    route({
      messages: () =>
        json({
          messages: [
            message({
              body: '',
              attachments: [
                {
                  id: '77777777-7777-4777-8777-777777777777',
                  fileName: 'parcel.webp',
                  contentType: 'image/webp',
                  byteSize: 2048,
                  width: 800,
                  height: 600,
                  durationMs: null,
                  url: '/chat/attachments/77777777-7777-4777-8777-777777777777/media',
                  thumbnailUrl:
                    '/chat/attachments/77777777-7777-4777-8777-777777777777/media?variant=thumb',
                },
                {
                  id: '88888888-8888-4888-8888-888888888888',
                  fileName: 'invoice.pdf',
                  contentType: 'application/pdf',
                  byteSize: 40_960,
                  width: null,
                  height: null,
                  durationMs: null,
                  url: '/chat/attachments/88888888-8888-4888-8888-888888888888/media',
                  thumbnailUrl: null,
                },
              ],
            }),
          ],
          nextCursor: null,
        }),
    });
    render(<SupportWidget />);

    openSupport({ conversationId: CONVERSATION_ID });

    const picture = await screen.findByAltText<HTMLImageElement>('parcel.webp');
    // The thumbnail is shown inside a button; the full picture opens over the panel.
    // Both come from this app's own media proxy: the API's path is private and carries no token,
    // so the browser must never be handed the bucket address or an object key.
    expect(picture.getAttribute('src')).toBe(
      '/api/support/media/77777777-7777-4777-8777-777777777777?variant=thumb',
    );
    fireEvent.click(screen.getByRole('button', { name: /parcel\.webp/ }));
    const viewer = screen.getByRole('dialog');
    // The picture itself loads, but its address is never offered as a link or printed.
    expect(
      viewer.querySelector('img[src="/api/support/media/77777777-7777-4777-8777-777777777777"]'),
    ).toBeTruthy();
    expect(viewer.querySelector('a[href]')).toBeNull();
    expect(viewer.textContent).not.toContain('/api/support/media');
    fireEvent.click(screen.getByRole('button', { name: 'Close the picture' }));
    const document = screen.getByRole('link', { name: /invoice\.pdf/ });
    expect(document.getAttribute('href')).toBe(
      '/api/support/media/88888888-8888-4888-8888-888888888888',
    );
  });

  it('says live updates are unavailable instead of pretending to be connected', async () => {
    route({});
    render(<SupportWidget />);

    fireEvent.click(launcher());

    expect(await screen.findByText(/Offline/)).toBeTruthy();
  });

  it('sends a reply and shows it without a reload', async () => {
    route({});
    render(<SupportWidget />);

    openSupport({ conversationId: CONVERSATION_ID });
    const field = await screen.findByLabelText('Message');
    expect((field as HTMLTextAreaElement).value).toBe('');

    fireEvent.change(field, { target: { value: 'Thank you' } });
    const sendButton = screen.getByRole('button', { name: 'Send message' });
    expect((sendButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/support',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText('Thank you')).toBeTruthy();
  });

  it('shows a reply before the API answers, then keeps a single copy', async () => {
    let answer!: (response: Response) => void;
    route({
      send: () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    });
    render(<SupportWidget />);

    openSupport({ conversationId: CONVERSATION_ID });
    const field = await screen.findByLabelText('Message');
    fireEvent.change(field, { target: { value: 'Thank you' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    // On screen from the keystroke, and the composer is already free for the next message.
    expect(await screen.findByText('Thank you')).toBeTruthy();
    expect(screen.getByText(/Sending…/)).toBeTruthy();
    expect(screen.getByLabelText<HTMLTextAreaElement>('Message').value).toBe('');

    answer(
      await json(
        {
          message: message({ senderRole: 'customer', body: 'Thank you' }),
          duplicate: false,
          unread: 0,
        },
        201,
      ),
    );

    await waitFor(() => expect(screen.queryByText(/Sending…/)).toBeNull());
    expect(screen.getAllByText('Thank you')).toHaveLength(1);
  });

  it('keeps an unsent reply and retries it under the same client id', async () => {
    let attempts = 0;
    route({
      send: () => {
        attempts += 1;
        return attempts === 1
          ? json({ error: { code: 'unavailable', message: 'Nilzora is offline.' } }, 503)
          : json(
              {
                message: message({ senderRole: 'customer', body: 'Thank you' }),
                duplicate: false,
                unread: 0,
              },
              201,
            );
      },
    });
    render(<SupportWidget />);

    openSupport({ conversationId: CONVERSATION_ID });
    fireEvent.change(await screen.findByLabelText('Message'), { target: { value: 'Thank you' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText(/Not sent/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry sending this message' }));

    await waitFor(() => expect(screen.queryByText(/Not sent/)).toBeNull());
    expect(screen.getAllByText('Thank you')).toHaveLength(1);

    const clients = fetchMock.mock.calls
      .map(([, init]) => init?.body)
      .filter((body): body is string => typeof body === 'string')
      .map((body) => JSON.parse(body) as { op?: string; clientMessageId?: string })
      .filter((body) => body.op === 'send')
      .map((body) => body.clientMessageId);
    // The server can tell a retry from a second message: both attempts carry one id.
    expect(clients).toHaveLength(2);
    expect(clients[0]).toBe(clients[1]);
  });

  it('asks a signed-out visitor to sign in instead of showing an empty inbox', async () => {
    route({ list: () => json({ error: { code: 'signed_out', message: 'Sign in' } }, 401) });
    render(<SupportWidget />);

    fireEvent.click(launcher());

    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeTruthy();
  });

  it('puts a common question in the box without sending it', async () => {
    route({});
    render(<SupportWidget />);
    fireEvent.click(launcher());

    const chip = await screen.findByRole('button', { name: 'Where is my order?' });
    fireEvent.click(chip);

    // The question is written, ready to edit — and nothing has been posted.
    expect(screen.getByLabelText<HTMLTextAreaElement>('Message').value).toBe(
      'Where is my order, please?',
    );
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    // The chips step aside once the box has something in it.
    expect(screen.queryByRole('button', { name: 'Track my delivery' })).toBeNull();
  });

  it('answers the message the customer picked, not the newest one', async () => {
    const older = message({ id: '77777777-7777-4777-8777-777777777777', seq: 1 });
    const newest = message({
      id: '88888888-8888-4888-8888-888888888888',
      seq: 2,
      body: 'Anything else I can help with?',
    });
    route({ messages: () => json({ messages: [older, newest], nextCursor: null }) });
    render(<SupportWidget />);

    openSupport({ conversationId: CONVERSATION_ID });
    // The first message on screen, which is deliberately not the newest.
    const more = await screen.findAllByRole('button', {
      name: 'More actions for the message from Staff One',
    });
    fireEvent.click(more[0] as HTMLElement);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }));

    expect(screen.getByText('Replying to Staff One')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'About the first one' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true);
    });
    const sent = fetchMock.mock.calls
      .map(([, init]) => init?.body)
      .filter((body): body is string => typeof body === 'string')
      .map((body) => JSON.parse(body) as { op?: string; replyToId?: string; body?: string })
      .find((body) => body.op === 'send');
    expect(sent?.body).toBe('About the first one');
    expect(sent?.replyToId).toBe(older.id);
    // The strip goes away once the reply has been sent.
    await waitFor(() => expect(screen.queryByText('Replying to Staff One')).toBeNull());
  });

  it('shows the quoted message above a reply and can drop the quote again', async () => {
    route({
      messages: () =>
        json({
          messages: [
            message({
              id: '99999999-9999-4999-8999-999999999999',
              seq: 2,
              senderRole: 'customer',
              senderName: 'Customer One',
              body: 'Sure, thanks',
              replyToId: '77777777-7777-4777-8777-777777777777',
              replyTo: {
                id: '77777777-7777-4777-8777-777777777777',
                seq: 1,
                senderId: null,
                senderRole: 'staff',
                senderName: 'Staff One',
                kind: 'text',
                body: 'Two days to Sylhet.',
                hasAttachment: false,
                deleted: false,
              },
            }),
          ],
          nextCursor: null,
        }),
    });
    render(<SupportWidget />);

    openSupport({ conversationId: CONVERSATION_ID });
    expect(await screen.findByText('Two days to Sylhet.')).toBeTruthy();
    // The quote is a way back to the original, named for a screen reader.
    expect(screen.getByRole('button', { name: /Go to the message from Staff One/ })).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for the message from Customer One' }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop replying to this message' }));
    expect(screen.queryByText('Replying to Customer One')).toBeNull();
  });
});
