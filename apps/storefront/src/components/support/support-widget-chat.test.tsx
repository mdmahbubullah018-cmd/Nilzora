import type {
  ChatAttachment,
  ChatConversationDetail,
  ChatConversationSummary,
  ChatMessage,
} from '@nilzora/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSupport } from '@/lib/support-events';
import { FakeXhr } from '@/testing/fake-xhr';
import { SupportWidget } from './support-widget';

/*
 * The customer chat widget's interaction layer: reactions, the message actions menu, the attach
 * picker and its upload/retry rules, the microphone/send swap, voice recording and the timing of
 * "Was this helpful?". The API is stubbed at `fetch` (JSON) and `XMLHttpRequest` (uploads), the
 * only two doors the browser has to it. None of this talks to a real server.
 */

const fetchMock = vi.fn<typeof fetch>();

const CONVERSATION_ID = '44444444-4444-4444-8444-444444444444';
const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';
const RESOLVED_AT = '2026-11-03T12:00:00.000Z';

let uuidCounter = 0;

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

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
    unreadCount: 0,
    latestSeq: 1,
    createdAt: '2026-11-03T10:00:00.000Z',
    updatedAt: '2026-11-03T10:00:00.000Z',
    ...overrides,
  };
}

function detail(
  status: ChatConversationDetail['conversation']['status'] = 'open',
  extra: Partial<ChatConversationDetail['conversation']> = {},
): ChatConversationDetail {
  return {
    conversation: {
      ...summary({ status }),
      resolvedAt: status === 'resolved' ? RESOLVED_AT : null,
      closedAt: status === 'closed' ? RESOLVED_AT : null,
      ...extra,
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
  };
}

function message(seq: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: id(seq),
    seq,
    senderId: null,
    senderRole: 'staff',
    senderName: 'Staff One',
    kind: 'text',
    body: `Staff reply ${String(seq)}`,
    replyToId: null,
    metadata: {},
    editedAt: null,
    createdAt: '2026-11-03T10:05:00.000Z',
    attachments: [],
    ...overrides,
  };
}

function mine(seq: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return message(seq, {
    senderId: CUSTOMER_ID,
    senderRole: 'customer',
    senderName: 'Customer One',
    body: `My message ${String(seq)}`,
    ...overrides,
  });
}

function attachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    fileName: 'photo-123.webp',
    contentType: 'image/webp',
    byteSize: 2048,
    width: 800,
    height: 600,
    durationMs: null,
    url: '/chat/attachments/77777777-7777-4777-8777-777777777777/media',
    thumbnailUrl: '/chat/attachments/77777777-7777-4777-8777-777777777777/media?variant=thumb',
    ...overrides,
  };
}

interface Handlers {
  detail?: ChatConversationDetail;
  messages?: ChatMessage[];
  reactions?: unknown[];
  myFeedback?: () => Promise<Response>;
  react?: (body: Record<string, unknown>) => Promise<Response>;
  report?: (body: Record<string, unknown>) => Promise<Response>;
  post?: (body: Record<string, unknown>) => Promise<Response>;
  feedback?: (body: Record<string, unknown>) => Promise<Response>;
  list?: ChatConversationSummary[];
}

/** Routes the widget's JSON calls by operation, so a test states only what it cares about. */
function route(handlers: Handlers = {}): void {
  fetchMock.mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? 'GET';
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};

    if (url.includes('op=ticket')) {
      return json({ error: { code: 'realtime_unavailable', message: 'off' } }, 503);
    }
    if (url.includes('op=thread')) return json(handlers.detail ?? detail());
    if (url.includes('op=messages')) {
      return json({ messages: handlers.messages ?? [message(1)], nextCursor: null });
    }
    if (url.includes('op=reactions')) return json({ reactions: handlers.reactions ?? [] });
    if (url.includes('op=my-feedback')) {
      return handlers.myFeedback?.() ?? json({ feedback: [] });
    }
    if (url.includes('op=list')) {
      return json({
        conversations: handlers.list ?? [summary()],
        unread: 0,
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      });
    }
    if (method === 'POST') {
      if (body.op === 'read') return json({ unread: 0 });
      if (body.op === 'react') {
        return (
          handlers.react?.(body) ??
          json({
            messageId: body.messageId,
            emoji: body.emoji,
            added: true,
            summary: [{ emoji: body.emoji, count: 1 }],
          })
        );
      }
      if (body.op === 'report') {
        return (
          handlers.report?.(body) ??
          json({ id: id(900), messageId: body.messageId, status: 'open' }, 201)
        );
      }
      if (body.op === 'message-feedback') {
        return (
          handlers.feedback?.(body) ??
          json({
            id: id(901),
            messageId: body.messageId,
            verdict: body.verdict,
            comment: null,
            createdAt: RESOLVED_AT,
            updatedAt: RESOLVED_AT,
          })
        );
      }
      if (body.op === 'discard-attachment')
        return Promise.resolve(new Response(null, { status: 204 }));
      if (body.op === 'send') {
        return json(
          { message: mine(50, { body: String(body.body) }), duplicate: false, unread: 0 },
          201,
        );
      }
      if (body.op === 'post') {
        return (
          handlers.post?.(body) ??
          json(
            {
              message: mine(60, { body: typeof body.body === 'string' ? body.body : null }),
              duplicate: false,
              unreadCount: 0,
              attachments: [],
            },
            201,
          )
        );
      }
    }
    return json({}, 404);
  });
}

function calls(op: string): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .map(([, init]) => init?.body)
    .filter((body): body is string => typeof body === 'string')
    .map((body) => JSON.parse(body) as Record<string, unknown>)
    .filter((body) => body.op === op);
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function reads(fragment: string): number {
  return fetchMock.mock.calls.filter(([url]) => urlOf(url).includes(fragment)).length;
}

async function openThread(): Promise<void> {
  render(<SupportWidget />);
  openSupport({ conversationId: CONVERSATION_ID });
  await screen.findByRole('region', { name: 'Customer support chat' });
  await waitFor(() => expect(reads('op=messages')).toBeGreaterThan(0));
  await waitFor(() => expect(screen.queryByText(/Loading the conversation/)).toBeNull());
}

// ---------------------------------------------------------------------------------------------
// Uploads: XMLHttpRequest, played by hand or answered automatically
// ---------------------------------------------------------------------------------------------

type UploadAnswer = { status: number; body: unknown } | 'network';

class UploadXhr extends FakeXhr {
  /** When set, every upload is answered at once; otherwise the test plays the events. */
  static auto: ((upload: UploadXhr, index: number) => UploadAnswer) | null = null;
  static count = 0;

  override send(body: FormData | Blob): void {
    super.send(body as FormData);
    const index = UploadXhr.count;
    UploadXhr.count += 1;
    const answer = UploadXhr.auto?.(this, index);
    if (answer === undefined) return;
    setTimeout(() => {
      if (answer === 'network') {
        this.fail();
        return;
      }
      this.progress(1, 1);
      this.transferred();
      this.answer(answer.body as object, answer.status);
    }, 0);
  }
}

function uploaded(fileName: string, n: number): UploadAnswer {
  return {
    status: 201,
    body: { id: `5555555${String(n)}-5555-4555-8555-555555555555`, fileName },
  };
}

function uploads(): UploadXhr[] {
  return FakeXhr.all;
}

function image(name: string): File {
  return new File([new Uint8Array(16)], name, { type: 'image/webp' });
}

function pickPhotos(files: File[]): void {
  const input = document.querySelector('input[aria-label="Choose photos"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

// ---------------------------------------------------------------------------------------------
// A hand-played MediaRecorder: jsdom has neither a microphone nor a recorder
// ---------------------------------------------------------------------------------------------

class FakeTrack {
  stop(): void {
    // Released by the recorder.
  }
}

class FakeStream {
  getTracks(): FakeTrack[] {
    return [new FakeTrack()];
  }
}

class FakeMediaRecorder {
  static last: FakeMediaRecorder | null = null;
  static isTypeSupported = (type: string) => type === 'audio/webm';
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  stream: FakeStream;

  constructor(stream: FakeStream) {
    this.stream = stream;
    FakeMediaRecorder.last = this;
  }

  start(): void {
    this.state = 'recording';
  }
  pause(): void {
    this.state = 'paused';
  }
  resume(): void {
    this.state = 'recording';
  }
  emit(bytes: number): void {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: 'audio/webm' }) });
  }
  stop(): void {
    this.state = 'inactive';
    this.onstop?.();
  }
}

function installMicrophone(permission: 'granted' | 'denied' = 'granted') {
  FakeMediaRecorder.last = null;
  const getUserMedia = vi.fn(() =>
    permission === 'granted'
      ? Promise.resolve(new FakeStream())
      : Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })),
  );
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia },
    configurable: true,
  });
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:voice', revokeObjectURL: vi.fn() }),
  );
  return getUserMedia;
}

beforeEach(() => {
  uuidCounter = 0;
  UploadXhr.auto = null;
  UploadXhr.count = 0;
  FakeXhr.reset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('XMLHttpRequest', UploadXhr);
  vi.stubGlobal('crypto', {
    randomUUID: () => {
      uuidCounter += 1;
      return `aaaaaaaa-0000-4000-8000-${String(uuidCounter).padStart(12, '0')}`;
    },
  });
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'mediaDevices');
  Reflect.deleteProperty(navigator, 'clipboard');
});

// ---------------------------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------------------------

describe('reaction bar', () => {
  it('opens beside the pressed message, outside the scroller, and reacts to that message', async () => {
    route({ messages: [message(1), message(2)] });
    await openThread();

    const react = screen.getAllByRole('button', { name: 'React to the message from Staff One' });
    fireEvent.click(react[1] as HTMLElement);

    const bar = await screen.findByRole('toolbar', { name: 'React to this message' });
    // Drawn in a portal on the body with fixed coordinates: the thread's scroller cannot clip it.
    expect(screen.getByRole('region', { name: 'Customer support chat' }).contains(bar)).toBe(false);
    expect(bar.closest<HTMLElement>('[data-testid="message-overlay-layer"]')?.style.position).toBe(
      'fixed',
    );
    expect(bar.querySelectorAll('button')).toHaveLength(8);

    fireEvent.click(within(bar).getByRole('button', { name: 'Love' }));
    await waitFor(() => expect(calls('react')).toHaveLength(1));
    expect(calls('react')[0]).toEqual({
      op: 'react',
      conversationId: CONVERSATION_ID,
      messageId: id(2),
      emoji: '❤️',
    });
    // The bar closes after a choice, and the count appears under the message.
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(await screen.findByRole('button', { name: 'Love: 1, your reaction' })).toBeTruthy();
  });

  function setViewport(width: number, height: number): () => void {
    const before = { width: window.innerWidth, height: window.innerHeight };
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    return () => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: before.width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: before.height });
    };
  }

  it.each([
    [320, '4', '2'],
    [360, '4', '2'],
    [768, '8', '1'],
    [1280, '8', '1'],
  ])('at %i px wide the bar is a %s-column grid of 44 px buttons', async (width, columns, rows) => {
    const restore = setViewport(width, 700);
    try {
      route();
      await openThread();
      fireEvent.click(screen.getByRole('button', { name: 'React to the message from Staff One' }));
      const bar = await screen.findByRole('toolbar', { name: 'React to this message' });
      await waitFor(() => expect(bar.getAttribute('data-columns')).toBe(columns));
      expect(bar.style.gridTemplateColumns).toBe(`repeat(${columns}, 44px)`);
      expect(Math.ceil(8 / Number(columns))).toBe(Number(rows));
      const buttons = within(bar).getAllByRole('button');
      expect(buttons).toHaveLength(8);
      for (const button of buttons) {
        expect(button.className).toContain('size-11');
        expect(button.className).not.toContain('size-10');
      }
    } finally {
      restore();
    }
  });

  it('stacks the bar and the menu in one layer and caps its height to the viewport', async () => {
    const restore = setViewport(360, 240);
    try {
      route();
      await openThread();
      const bubble = screen.getByText('Staff reply 1');
      fireEvent.pointerDown(bubble, { pointerType: 'touch', clientX: 10, clientY: 10 });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 560));
      });
      const bar = screen.getByRole('toolbar', { name: 'React to this message' });
      const menu = screen.getByRole('menu', { name: 'Message actions' });
      const layer = bar.closest('[data-testid="message-overlay-layer"]') as HTMLElement;
      expect(layer.contains(menu)).toBe(true);
      // One fixed layer: the two cannot be placed independently, so they cannot overlap.
      expect(layer.className).toContain('flex-col');
      await waitFor(() => expect(layer.style.maxHeight).toBe('216px'));
      // The menu is the part that scrolls when the viewport is too short for both.
      expect(menu.parentElement?.className).toContain('overflow-y-auto');
      for (const item of within(menu).getAllByRole('menuitem')) {
        expect(item.className).toContain('min-h-11');
      }
    } finally {
      restore();
    }
  });

  it('gives the react and more triggers and the count chips a 44 px target', async () => {
    route({ reactions: [{ messageId: id(1), emoji: '👍', count: 2, mine: false }] });
    await openThread();
    for (const trigger of [
      screen.getByRole('button', { name: 'React to the message from Staff One' }),
      screen.getByRole('button', { name: 'More actions for the message from Staff One' }),
    ]) {
      expect(trigger.className).toContain('size-11');
    }
    const chip = await screen.findByRole('button', { name: 'Like: 2' });
    expect(chip.className).toContain('min-h-11');
    expect(chip.className).toContain('min-w-11');
    expect(chip.getAttribute('aria-pressed')).toBe('false');
  });

  it('opens for the message that was pressed each time, never a stale one', async () => {
    route({ messages: [message(1), message(2)] });
    await openThread();
    const react = screen.getAllByRole('button', { name: 'React to the message from Staff One' });

    fireEvent.click(react[1] as HTMLElement);
    await screen.findByRole('toolbar');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('toolbar')).toBeNull();

    fireEvent.click(react[0] as HTMLElement);
    fireEvent.click(
      within(await screen.findByRole('toolbar')).getByRole('button', { name: 'Like' }),
    );
    await waitFor(() => expect(calls('react')).toHaveLength(1));
    expect(calls('react')[0]?.messageId).toBe(id(1));
  });

  it('dismisses on Escape and on a press outside', async () => {
    route();
    await openThread();
    const react = screen.getByRole('button', { name: 'React to the message from Staff One' });

    fireEvent.click(react);
    await screen.findByRole('toolbar');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('toolbar')).toBeNull();

    fireEvent.click(react);
    await screen.findByRole('toolbar');
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('reads the thread reactions once for all rows, and again when a realtime update arrives', async () => {
    route({
      messages: [message(1), message(2), message(3)],
      reactions: [{ messageId: id(2), emoji: '👍', count: 2, mine: true }],
    });
    await openThread();
    expect(await screen.findByRole('button', { name: 'Like: 2, your reaction' })).toBeTruthy();
    // Three messages on screen, one read: no per-row requests.
    expect(reads('op=reactions')).toBe(1);
  });

  it('removes the own reaction when its count is tapped', async () => {
    route({
      messages: [message(1)],
      reactions: [{ messageId: id(1), emoji: '👍', count: 1, mine: true }],
      react: () => json({ messageId: id(1), emoji: '👍', added: false, summary: [] }),
    });
    await openThread();
    fireEvent.click(await screen.findByRole('button', { name: 'Like: 1, your reaction' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Like: / })).toBeNull());
    expect(calls('react')).toHaveLength(1);
  });

  it('can react to the assistant but not to system rows or order events', async () => {
    route({
      messages: [
        message(1, { kind: 'automated', senderName: null, body: 'I can help with that.' }),
        message(2, { kind: 'system', senderRole: 'system', body: 'Support joined.' }),
        message(3, { kind: 'order_event', senderRole: 'system', body: 'Order shipped.' }),
      ],
    });
    await openThread();
    expect(
      screen.getAllByRole('button', { name: 'React to the message from Nilzora Assistant' }),
    ).toHaveLength(1);
    expect(screen.getByText('Support joined.')).toBeTruthy();
    // Only the assistant's message has any control at all.
    expect(screen.getAllByRole('button', { name: /^React to/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^More actions/ })).toHaveLength(1);
  });

  it('opens the bar and the menu together on a long press', async () => {
    route();
    await openThread();
    const bubble = screen.getByText('Staff reply 1');
    fireEvent.pointerDown(bubble, { pointerType: 'touch', clientX: 10, clientY: 10 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 560));
    });
    expect(screen.getByRole('toolbar', { name: 'React to this message' })).toBeTruthy();
    expect(screen.getByRole('menu', { name: 'Message actions' })).toBeTruthy();
  });

  it('does not open on a short press or a drag', async () => {
    route();
    await openThread();
    const bubble = screen.getByText('Staff reply 1');
    fireEvent.pointerDown(bubble, { pointerType: 'touch', clientX: 10, clientY: 10 });
    fireEvent.pointerMove(bubble, { pointerType: 'touch', clientX: 60, clientY: 10 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 560));
    });
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The actions menu
// ---------------------------------------------------------------------------------------------

function openMenuFor(label: string, index = 0): HTMLElement {
  fireEvent.click(
    screen.getAllByRole('button', { name: `More actions for the message from ${label}` })[
      index
    ] as HTMLElement,
  );
  return screen.getByRole('menu', { name: 'Message actions' });
}

describe('message actions menu', () => {
  it('offers Reply, Copy and Report for a reply from the team', async () => {
    route();
    await openThread();
    const menu = openMenuFor('Staff One');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Reply', 'Copy', 'Report']);
  });

  it('never offers Report for the customer own message, and never staff-only actions', async () => {
    route({ messages: [mine(1)] });
    await openThread();
    const menu = openMenuFor('Customer One');
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(items).toEqual(['Reply', 'Copy']);
    expect(menu.textContent).not.toMatch(/pin|delete|note|forward|edit/i);
  });

  it('copies the text and confirms it', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    route();
    await openThread();
    fireEvent.click(within(openMenuFor('Staff One')).getByRole('menuitem', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Staff reply 1'));
    expect((await screen.findByText('Message copied.')).getAttribute('role') ?? 'status').toBe(
      'status',
    );
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('reports a reply after choosing a reason, through the existing report operation', async () => {
    route();
    await openThread();
    fireEvent.click(within(openMenuFor('Staff One')).getByRole('menuitem', { name: 'Report' }));
    const reasons = screen.getByRole('menu', { name: 'Report this message' });
    expect(
      within(reasons)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Spam or unwanted',
      'Abusive or offensive',
      'Shares personal information',
      'Something else',
      'Back',
    ]);
    // Nothing is sent until a reason is chosen.
    expect(calls('report')).toHaveLength(0);
    fireEvent.click(within(reasons).getByRole('menuitem', { name: 'Abusive or offensive' }));

    await waitFor(() => expect(calls('report')).toHaveLength(1));
    expect(calls('report')[0]).toEqual({ op: 'report', messageId: id(1), reason: 'abuse' });
    expect(await screen.findByText(/your report was sent/)).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps the reason picker open and explains when a report fails', async () => {
    route({
      report: () => json({ error: { code: 'rate_limited', message: 'Wait a moment.' } }, 429),
    });
    await openThread();
    fireEvent.click(within(openMenuFor('Staff One')).getByRole('menuitem', { name: 'Report' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Spam or unwanted' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Wait a moment.');
    expect(screen.getByRole('menu', { name: 'Report this message' })).toBeTruthy();
  });

  it('opens a picture in the existing lightbox from "View attachment"', async () => {
    route({ messages: [message(1, { body: 'photo-123.webp', attachments: [attachment()] })] });
    await openThread();
    fireEvent.click(
      within(openMenuFor('Staff One')).getByRole('menuitem', { name: 'View attachment' }),
    );
    const viewer = await screen.findByRole('dialog');
    expect(
      viewer.querySelector('img[src="/api/support/media/77777777-7777-4777-8777-777777777777"]'),
    ).toBeTruthy();
  });

  it('offers a document as a download link through the media proxy', async () => {
    route({
      messages: [
        message(1, {
          body: 'invoice.pdf',
          attachments: [
            attachment({
              id: '88888888-8888-4888-8888-888888888888',
              fileName: 'invoice.pdf',
              contentType: 'application/pdf',
              width: null,
              height: null,
              url: '/chat/attachments/88888888-8888-4888-8888-888888888888/media',
              thumbnailUrl: null,
            }),
          ],
        }),
      ],
    });
    await openThread();
    const link = within(openMenuFor('Staff One')).getByRole('menuitem', {
      name: 'View attachment',
    });
    expect(link.getAttribute('href')).toBe(
      '/api/support/media/88888888-8888-4888-8888-888888888888',
    );
    expect(link.getAttribute('download')).toBe('invoice.pdf');
  });

  it('closes on Escape', async () => {
    route();
    await openThread();
    openMenuFor('Staff One');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Attachment-only messages
// ---------------------------------------------------------------------------------------------

describe('attachment-only messages', () => {
  it('does not draw the stored file names as a caption', async () => {
    route({
      messages: [mine(1, { body: 'photo-123.webp', attachments: [attachment()] })],
      list: [summary({ lastMessagePreview: 'photo-123.webp' })],
    });
    await openThread();
    expect(await screen.findByAltText('photo-123.webp')).toBeTruthy();
    // The only text with that name is the picture's alt: no caption paragraph.
    expect(screen.queryByText('photo-123.webp')).toBeNull();
  });

  it('keeps a real caption under the picture', async () => {
    route({ messages: [mine(1, { body: 'The box arrived dented', attachments: [attachment()] })] });
    await openThread();
    expect(await screen.findByText('The box arrived dented')).toBeTruthy();
  });

  it('quotes a picture as "Attachment", not its file name', async () => {
    route({ messages: [message(1, { body: 'photo-123.webp', attachments: [attachment()] })] });
    await openThread();
    fireEvent.click(within(openMenuFor('Staff One')).getByRole('menuitem', { name: 'Reply' }));
    expect(screen.getByText('Replying to Staff One')).toBeTruthy();
    expect(screen.getByText('Attachment')).toBeTruthy();
    expect(screen.queryByText('photo-123.webp')).toBeNull();
  });

  it('previews an attachment-only message in the list as "Attachment"', async () => {
    route({ list: [summary({ lastMessagePreview: 'photo-123.webp' })] });
    render(<SupportWidget />);
    fireEvent.click(screen.getByRole('button', { name: /support chat/i }));
    expect(await screen.findByText('Attachment')).toBeTruthy();
    expect(screen.queryByText('photo-123.webp')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Composer: attach, send, retry
// ---------------------------------------------------------------------------------------------

describe('attaching and sending files', () => {
  it('previews chosen pictures, uploads nothing until Send, and removes before sending', async () => {
    route();
    await openThread();
    fireEvent.click(screen.getByRole('button', { name: 'Attach a photo or file' }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Photos',
      'Files',
    ]);
    fireEvent.keyDown(document, { key: 'Escape' });

    pickPhotos([image('a.webp'), image('b.webp')]);
    expect(screen.getByText('a.webp')).toBeTruthy();
    expect(screen.getByText('b.webp')).toBeTruthy();
    expect(uploads()).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Remove b.webp' }));
    expect(screen.queryByText('b.webp')).toBeNull();
    expect(uploads()).toHaveLength(0);
  });

  it('says why a file was refused and still accepts the others', async () => {
    route();
    await openThread();
    const input = document.querySelector('input[aria-label="Choose photos"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          image('ok.webp'),
          new File([new Uint8Array(4)], 'run.exe', { type: 'application/x-msdownload' }),
        ],
      },
    });
    expect(screen.getByText('ok.webp')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/run\.exe/);
  });

  it('shows real byte progress per file, then processing, then posts the uploaded ids', async () => {
    route();
    await openThread();
    pickPhotos([image('a.webp')]);
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(uploads()).toHaveLength(1));
    const upload = uploads()[0] as UploadXhr;
    expect(upload.url).toMatch(/^\/api\/support\/attachments\?conversationId=/);
    expect(upload.headers['Content-Type']).toBe('image/webp');

    act(() => upload.progress(50, 100));
    const bar = await screen.findByRole('progressbar', { name: 'Uploading a.webp' });
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(screen.getByText(/Uploading 50%/)).toBeTruthy();

    act(() => upload.transferred());
    expect(await screen.findByText(/Processing…/)).toBeTruthy();
    act(() => {
      upload.answer({ id: '55555551-5555-4555-8555-555555555555', fileName: 'a.webp' }, 201);
    });
    await waitFor(() => expect(calls('post')).toHaveLength(1));
    expect(calls('post')[0]?.attachmentIds).toEqual(['55555551-5555-4555-8555-555555555555']);
  });

  it('shows the sent picture exactly once after the post is stored', async () => {
    route({
      post: () =>
        json(
          {
            message: mine(60, { body: 'photo-123.webp' }),
            duplicate: false,
            unreadCount: 0,
            attachments: [attachment()],
          },
          201,
        ),
    });
    UploadXhr.auto = () => uploaded('photo-123.webp', 1);
    await openThread();
    pickPhotos([image('photo-123.webp')]);
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByAltText('photo-123.webp')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/Sending…/)).toBeNull());
    expect(screen.getAllByAltText('photo-123.webp')).toHaveLength(1);
    expect(screen.queryByRole('list', { name: 'Files being sent' })).toBeNull();
    // The stored file names are not drawn as a caption either.
    expect(screen.queryByText('photo-123.webp')).toBeNull();
  });

  it('retries only the file that failed, then posts both, without uploading the first again', async () => {
    route();
    UploadXhr.auto = (_upload, index) =>
      index === 1
        ? {
            status: 422,
            body: {
              error: {
                code: 'image_invalid',
                message: 'That picture could not be read. Try another one.',
              },
            },
          }
        : uploaded(index === 0 ? 'a.webp' : 'b.webp', index + 1);
    await openThread();
    pickPhotos([image('a.webp'), image('b.webp')]);
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText(/That picture could not be read/)).toBeTruthy();
    expect(uploads()).toHaveLength(2);
    expect(calls('post')).toHaveLength(0);
    // The first file is already uploaded and says so.
    expect(screen.getByText(/· Uploaded/)).toBeTruthy();

    UploadXhr.auto = (_upload, index) => uploaded('b.webp', index + 1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry sending this message' }));

    await waitFor(() => expect(calls('post')).toHaveLength(1));
    // Three uploads in all: a, b (failed), b again. Never a again.
    expect(uploads()).toHaveLength(3);
    expect(calls('post')[0]?.attachmentIds).toHaveLength(2);
  });

  it('retries only the post, under the same client id, when the files already landed', async () => {
    let attempts = 0;
    route({
      post: () => {
        attempts += 1;
        return attempts === 1
          ? json({ error: { code: 'unavailable', message: 'Nilzora could not be reached.' } }, 503)
          : json(
              {
                message: mine(60, { body: null }),
                duplicate: false,
                unreadCount: 0,
                attachments: [attachment()],
              },
              201,
            );
      },
    });
    UploadXhr.auto = () => uploaded('a.webp', 1);
    await openThread();
    pickPhotos([image('a.webp')]);
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText(/Your files are already uploaded/)).toBeTruthy();
    expect(uploads()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Retry sending this message' }));
    await waitFor(() => expect(calls('post')).toHaveLength(2));
    // No second upload, the same message id and the same attachment ids.
    expect(uploads()).toHaveLength(1);
    expect(calls('post')[1]?.clientMessageId).toBe(calls('post')[0]?.clientMessageId);
    expect(calls('post')[1]?.attachmentIds).toEqual(calls('post')[0]?.attachmentIds);
    await waitFor(() => expect(screen.queryByText(/Not sent/)).toBeNull());
  });

  it('discards uploaded files when a failed message is removed', async () => {
    route({
      post: () =>
        json({ error: { code: 'unavailable', message: 'Nilzora could not be reached.' } }, 503),
    });
    UploadXhr.auto = () => uploaded('a.webp', 1);
    await openThread();
    pickPhotos([image('a.webp')]);
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText(/Your files are already uploaded/);

    fireEvent.click(screen.getByRole('button', { name: 'Remove this message that was not sent' }));
    await waitFor(() => expect(calls('discard-attachment')).toHaveLength(1));
    expect(screen.queryByText(/Not sent/)).toBeNull();
  });

  it('reports a dropped connection during an upload with a clear sentence and a retry', async () => {
    route();
    UploadXhr.auto = () => 'network';
    await openThread();
    pickPhotos([image('a.webp')]);
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByText('Check your connection and try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry sending this message' })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
// Microphone <-> Send, and voice
// ---------------------------------------------------------------------------------------------

describe('microphone and send', () => {
  it('shows the microphone when the box is empty, Send when there is text, and swaps back', async () => {
    route();
    await openThread();
    expect(screen.getByRole('button', { name: 'Record a voice message' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull();

    const field = screen.getByLabelText('Message');
    fireEvent.change(field, { target: { value: 'Hello' } });
    expect(screen.getByRole('button', { name: 'Send message' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record a voice message' })).toBeNull();

    fireEvent.change(field, { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Record a voice message' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull();
  });

  it('shows Send, not the microphone, once a file is chosen', async () => {
    route();
    await openThread();
    pickPhotos([image('a.webp')]);
    expect(screen.getByRole('button', { name: 'Send message' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Record a voice message' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.webp' }));
    expect(screen.getByRole('button', { name: 'Record a voice message' })).toBeTruthy();
  });
});

describe('voice messages', () => {
  it('asks for the microphone only when the button is pressed', async () => {
    const getUserMedia = installMicrophone();
    route();
    await openThread();
    expect(getUserMedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Stop recording' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause recording' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel the recording' })).toBeTruthy();
  });

  it('explains a refused permission and lets the person close the recorder', async () => {
    installMicrophone('denied');
    route();
    await openThread();
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/permission/);
    fireEvent.click(screen.getByRole('button', { name: 'Close the recorder' }));
    expect(screen.getByLabelText('Message')).toBeTruthy();
  });

  it('keeps the preview on screen after stopping, with length, playback, Send and Discard', async () => {
    installMicrophone();
    route();
    await openThread();
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await screen.findByRole('button', { name: 'Stop recording' });
    FakeMediaRecorder.last?.emit(2048);
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));

    // The bug this guards: the recorder used to vanish the moment it stopped.
    const group = await screen.findByRole('group', { name: 'Voice message' });
    expect(group.querySelector('audio')?.getAttribute('src')).toBe('blob:voice');
    expect(within(group).getByRole('button', { name: 'Send the voice message' })).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'Discard the recording' })).toBeTruthy();
    expect(within(group).getByText(/0:0\d/)).toBeTruthy();
    expect(uploads()).toHaveLength(0);

    fireEvent.click(within(group).getByRole('button', { name: 'Discard the recording' }));
    expect(screen.queryByRole('group', { name: 'Voice message' })).toBeNull();
    expect(uploads()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Record a voice message' })).toBeTruthy();
  });

  it('uploads the recording with its length, shows progress and posts it', async () => {
    installMicrophone();
    route();
    await openThread();
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await screen.findByRole('button', { name: 'Stop recording' });
    FakeMediaRecorder.last?.emit(2048);
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send the voice message' }));

    await waitFor(() => expect(uploads()).toHaveLength(1));
    const upload = uploads()[0] as UploadXhr;
    const query = new URL(upload.url, 'http://localhost').searchParams;
    expect(Number(query.get('durationMs'))).toBeGreaterThan(0);
    expect(upload.headers['Content-Type']).toBe('audio/webm');

    act(() => upload.progress(30, 100));
    expect((await screen.findByRole('progressbar')).getAttribute('aria-valuenow')).toBe('30');
    act(() => {
      upload.answer({ id: '55555551-5555-4555-8555-555555555555', fileName: 'voice.webm' }, 201);
    });
    await waitFor(() => expect(calls('post')).toHaveLength(1));
    expect(calls('post')[0]?.attachmentIds).toEqual(['55555551-5555-4555-8555-555555555555']);
  });

  it('keeps a failed voice upload retryable', async () => {
    installMicrophone();
    route();
    UploadXhr.auto = () => 'network';
    await openThread();
    fireEvent.click(screen.getByRole('button', { name: 'Record a voice message' }));
    await screen.findByRole('button', { name: 'Stop recording' });
    FakeMediaRecorder.last?.emit(2048);
    fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send the voice message' }));

    expect(await screen.findByRole('button', { name: 'Retry sending this message' })).toBeTruthy();
    UploadXhr.auto = () => uploaded('voice.webm', 1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry sending this message' }));
    await waitFor(() => expect(calls('post')).toHaveLength(1));
    expect(uploads()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------
// "Was this helpful?"
// ---------------------------------------------------------------------------------------------

const FINISHED_THREAD = [mine(1), message(2), message(3, { body: 'Your parcel ships today.' })];

describe('"Was this helpful?" timing', () => {
  it('is not asked, and not even looked up, while the conversation is open or in progress', async () => {
    for (const status of ['open', 'pending'] as const) {
      fetchMock.mockReset();
      route({ detail: detail(status), messages: FINISHED_THREAD });
      const view = render(<SupportWidget />);
      openSupport({ conversationId: CONVERSATION_ID });
      await screen.findByText('Your parcel ships today.');
      expect(screen.queryByText('Was this helpful?')).toBeNull();
      expect(reads('op=my-feedback')).toBe(0);
      view.unmount();
    }
  });

  it('is asked once, under the last real reply only, when the conversation is resolved', async () => {
    route({
      detail: detail('resolved', { lastCustomerMessageAt: '2026-11-03T10:00:00.000Z' }),
      messages: FINISHED_THREAD,
    });
    await openThread();
    expect(await screen.findByText('Was this helpful?')).toBeTruthy();
    expect(screen.getAllByText('Was this helpful?')).toHaveLength(1);
    expect(reads('op=my-feedback')).toBe(1);
    // It sits under the last reply, not under the earlier one.
    const last = screen.getByText('Your parcel ships today.').closest('li');
    expect(last?.textContent).toContain('Was this helpful?');
    expect(screen.getByText('Staff reply 2').closest('li')?.textContent).not.toContain(
      'Was this helpful?',
    );
  });

  it('is asked in a closed conversation too, and never offers a note', async () => {
    route({ detail: detail('closed'), messages: FINISHED_THREAD });
    render(<SupportWidget />);
    openSupport({ conversationId: CONVERSATION_ID });
    expect(await screen.findByText('Was this helpful?')).toBeTruthy();
    expect(screen.queryByText(/note/i)).toBeNull();
  });

  it('stays under the last real reply when system rows follow it', async () => {
    route({
      detail: detail('resolved'),
      messages: [
        mine(1),
        message(2, { body: 'Resolved for you.' }),
        message(3, { kind: 'system', senderRole: 'system', body: 'Conversation resolved.' }),
      ],
    });
    await openThread();
    await screen.findByText('Was this helpful?');
    expect(screen.getByText('Resolved for you.').closest('li')?.textContent).toContain(
      'Was this helpful?',
    );
    expect(screen.getByText('Conversation resolved.').closest('li')?.textContent).not.toContain(
      'Was this helpful?',
    );
  });

  it('is not asked again for a reply the customer already rated', async () => {
    route({
      detail: detail('resolved'),
      messages: FINISHED_THREAD,
      myFeedback: () => json({ feedback: [{ messageId: id(3), verdict: 'helpful' }] }),
    });
    await openThread();
    await waitFor(() => expect(reads('op=my-feedback')).toBe(1));
    await screen.findByText('Your parcel ships today.');
    expect(screen.queryByText('Was this helpful?')).toBeNull();
  });

  it('is not asked when the customer has written since it was resolved', async () => {
    route({
      detail: detail('resolved', { lastCustomerMessageAt: '2026-11-03T13:00:00.000Z' }),
      messages: FINISHED_THREAD,
    });
    await openThread();
    await waitFor(() => expect(reads('op=my-feedback')).toBe(1));
    expect(screen.queryByText('Was this helpful?')).toBeNull();
  });

  it('asks nothing when the lookup of earlier answers fails, rather than risk asking twice', async () => {
    route({
      detail: detail('resolved'),
      messages: FINISHED_THREAD,
      myFeedback: () => json({ error: { code: 'unavailable', message: 'down' } }, 503),
    });
    await openThread();
    await waitFor(() => expect(reads('op=my-feedback')).toBe(1));
    expect(screen.queryByText('Was this helpful?')).toBeNull();
  });

  it('records the verdict, says thanks, and then never asks again', async () => {
    route({ detail: detail('resolved'), messages: FINISHED_THREAD });
    await openThread();
    fireEvent.click(await screen.findByRole('button', { name: /Yes/ }));
    expect(await screen.findByText(/Thanks/)).toBeTruthy();
    expect(calls('message-feedback')).toEqual([
      { op: 'message-feedback', messageId: id(3), verdict: 'helpful' },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// Keyboard model of the reaction bar and the actions menu
// ---------------------------------------------------------------------------------------------

describe('keyboard model of the floating bar and menu', () => {
  const reactTrigger = () =>
    screen.getByRole('button', { name: 'React to the message from Staff One' });
  const moreTrigger = () =>
    screen.getByRole('button', { name: 'More actions for the message from Staff One' });
  const press = (key: string, options: { shiftKey?: boolean } = {}) => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key, ...options });
  };
  const barButtons = () =>
    within(screen.getByRole('toolbar', { name: 'React to this message' })).getAllByRole('button');
  const tabStops = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLElement>('button, a')].filter((item) => item.tabIndex === 0);

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
  });

  it('moves focus into the bar only once the layer is visible, and lands on the first reaction', async () => {
    route();
    await openThread();
    const seen: string[] = [];
    const onFocusIn = (event: FocusEvent) => {
      const layer = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-testid="message-overlay-layer"]',
      );
      if (layer !== null) seen.push(layer.style.visibility);
    };
    document.addEventListener('focusin', onFocusIn);
    try {
      reactTrigger().focus();
      fireEvent.click(reactTrigger());
      await screen.findByRole('toolbar', { name: 'React to this message' });
      expect(document.activeElement).toBe(barButtons()[0]);
      // A hidden element cannot take focus in a real browser: it must have been shown by then.
      expect(seen[0]).toBe('visible');
    } finally {
      document.removeEventListener('focusin', onFocusIn);
    }
  });

  it('is one tab stop, and the arrow keys, Home and End move between the reactions', async () => {
    route();
    await openThread();
    fireEvent.click(reactTrigger());
    await screen.findByRole('toolbar');
    const buttons = barButtons();
    expect(buttons).toHaveLength(8);
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);

    press('ArrowRight');
    expect(document.activeElement).toBe(buttons[1]);
    // Roving tabindex follows focus.
    expect(buttons[1]?.tabIndex).toBe(0);
    expect(buttons[0]?.tabIndex).toBe(-1);
    press('ArrowLeft');
    expect(document.activeElement).toBe(buttons[0]);
    press('ArrowLeft');
    expect(document.activeElement).toBe(buttons[7]);
    press('Home');
    expect(document.activeElement).toBe(buttons[0]);
    press('End');
    expect(document.activeElement).toBe(buttons[7]);
    // One row: Up and Down have nowhere to go and leave focus alone.
    press('ArrowDown');
    expect(document.activeElement).toBe(buttons[7]);
  });

  it('moves up and down by a row when the bar wraps on a narrow screen', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 360, configurable: true });
    route();
    await openThread();
    fireEvent.click(reactTrigger());
    const bar = await screen.findByRole('toolbar');
    const columns = Number(bar.getAttribute('data-columns'));
    expect(columns).toBeLessThan(8);
    const buttons = barButtons();
    press('ArrowDown');
    expect(document.activeElement).toBe(buttons[columns]);
    press('ArrowUp');
    expect(document.activeElement).toBe(buttons[0]);
    press('ArrowUp');
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('selects the focused reaction, restores focus to the trigger and reacts once', async () => {
    route();
    await openThread();
    reactTrigger().focus();
    fireEvent.click(reactTrigger());
    await screen.findByRole('toolbar');
    press('ArrowRight');
    // Enter and Space activate a native button as a click.
    fireEvent.click(document.activeElement as HTMLElement);
    await waitFor(() => expect(calls('react')).toHaveLength(1));
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(document.activeElement).toBe(reactTrigger());
  });

  it('closes on Escape and puts focus back on the control that opened it', async () => {
    route();
    await openThread();
    moreTrigger().focus();
    fireEvent.click(moreTrigger());
    await screen.findByRole('menu', { name: 'Message actions' });
    expect(document.activeElement).not.toBe(moreTrigger());
    press('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(moreTrigger());

    reactTrigger().focus();
    fireEvent.click(reactTrigger());
    await screen.findByRole('toolbar');
    press('Escape');
    expect(document.activeElement).toBe(reactTrigger());
  });

  it('walks the menu with the arrow keys and stays on the menu with Tab', async () => {
    route();
    await openThread();
    fireEvent.click(moreTrigger());
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Reply', 'Copy', 'Report']);
    expect(document.activeElement).toBe(items[0]);
    expect(tabStops(menu)).toEqual([items[0]]);

    press('ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    expect(tabStops(menu)).toEqual([items[1]]);
    press('End');
    expect(document.activeElement).toBe(items[2]);
    press('ArrowDown');
    expect(document.activeElement).toBe(items[0]);
    press('ArrowUp');
    expect(document.activeElement).toBe(items[2]);
    press('Home');
    expect(document.activeElement).toBe(items[0]);

    // The menu is the only widget (no bar for a "menu" open): Tab cannot leave it.
    press('Tab');
    expect(document.activeElement).toBe(items[0]);
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(items[0]);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('traps Tab inside the overlay, cycling bar and menu in both directions', async () => {
    route();
    await openThread();
    const bubble = screen.getByText('Staff reply 1');
    fireEvent.pointerDown(bubble, { pointerType: 'touch', clientX: 10, clientY: 10 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 560));
    });
    const menu = screen.getByRole('menu', { name: 'Message actions' });
    const bar = screen.getByRole('toolbar');
    // The long-press path is unchanged: both open, focus on the first menu item.
    expect(document.activeElement).toBe(within(menu).getAllByRole('menuitem')[0]);

    press('Tab');
    expect(bar.contains(document.activeElement)).toBe(true);
    press('Tab');
    expect(menu.contains(document.activeElement)).toBe(true);
    press('Tab', { shiftKey: true });
    expect(bar.contains(document.activeElement)).toBe(true);
    press('Tab', { shiftKey: true });
    expect(menu.contains(document.activeElement)).toBe(true);
    // Never out to the page behind.
    expect(screen.getByRole('toolbar')).toBeTruthy();
  });

  it('pulls Tab into the overlay when focus is still on the trigger', async () => {
    route();
    await openThread();
    reactTrigger().focus();
    fireEvent.click(reactTrigger());
    const bar = await screen.findByRole('toolbar');
    reactTrigger().focus();
    press('Tab');
    expect(bar.contains(document.activeElement)).toBe(true);
  });

  it('closes when the open control is pressed again instead of reopening', async () => {
    route();
    await openThread();
    fireEvent.click(reactTrigger());
    await screen.findByRole('toolbar');
    fireEvent.pointerDown(reactTrigger());
    fireEvent.click(reactTrigger());
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('keeps focus in the menu when it switches to the report reasons and back', async () => {
    route();
    await openThread();
    fireEvent.click(moreTrigger());
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Report' }));
    const reasons = await screen.findByRole('menu', { name: 'Report this message' });
    expect(reasons.contains(document.activeElement)).toBe(true);
    expect(tabStops(reasons)).toHaveLength(1);
    fireEvent.click(within(reasons).getByRole('menuitem', { name: 'Back' }));
    const back = await screen.findByRole('menu', { name: 'Message actions' });
    expect(back.contains(document.activeElement)).toBe(true);
  });

  it('offers Report on a Nilzora Assistant reply but not on the customer or a system line', async () => {
    route({
      messages: [
        message(1, {
          kind: 'automated',
          senderRole: 'system',
          senderName: null,
          body: 'I can help with that.',
        }),
        mine(2),
      ],
    });
    await openThread();
    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for the message from Nilzora Assistant' }),
    );
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Report' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for the message from Customer One' }),
    );
    const own = await screen.findByRole('menu', { name: 'Message actions' });
    expect(within(own).queryByRole('menuitem', { name: 'Report' })).toBeNull();
  });
});

describe('expanded chat window', () => {
  it('expands to a centred large-screen layout and returns to the compact one, keeping the thread', async () => {
    route();
    await openThread();
    const panel = screen.getByRole('region', { name: 'Customer support chat' });
    expect(panel.getAttribute('data-expanded')).toBeNull();
    expect(panel.className).toContain('lg:bottom-6');

    fireEvent.click(screen.getByRole('button', { name: 'Expand the chat window' }));
    expect(panel.getAttribute('data-expanded')).toBe('true');
    expect(panel.className).toContain('lg:left-1/2');
    expect(panel.className).toContain('lg:-translate-x-1/2');
    // Never wider than the viewport minus a margin: no horizontal scrolling.
    expect(panel.className).toContain('lg:w-[min(64rem,calc(100%_-_3rem))]');
    // The conversation and the composer are still there.
    expect(screen.getByPlaceholderText('Write a reply…')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Return to the compact chat window' }));
    expect(panel.getAttribute('data-expanded')).toBeNull();
    // The expand control is for large screens only; close stays available at every size.
    expect(screen.getByRole('button', { name: 'Close support chat' })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
// Touch targets
// ---------------------------------------------------------------------------------------------

describe('touch targets', () => {
  // jsdom does no layout: the classes that give 44px (size-11 / min-h-11 from the smallest screen,
  // and again on any coarse pointer) are what is asserted.
  const is44 = (element: HTMLElement) =>
    expect(/(^|\s)(size-11|min-h-11|h-11)(\s|$)/.test(element.className)).toBe(true);

  it('gives the widget close button, composer field, attach, microphone and send 44px', async () => {
    route();
    await openThread();
    is44(screen.getByRole('button', { name: 'Close support chat' }));
    is44(screen.getByRole('button', { name: 'Back to your conversations' }));
    is44(screen.getByRole('button', { name: 'Attach a photo or file' }));
    is44(screen.getByRole('button', { name: 'Record a voice message' }));
    is44(screen.getByPlaceholderText('Write a reply…'));
    for (const name of ['Close support chat', 'Attach a photo or file', 'Record a voice message']) {
      expect(screen.getByRole('button', { name }).className).toContain('pointer-coarse:');
    }
    fireEvent.change(screen.getByPlaceholderText('Write a reply…'), { target: { value: 'Hi' } });
    is44(await screen.findByRole('button', { name: 'Send message' }));
  });

  it('gives the retry and remove controls of an unsent message 44px', async () => {
    route();
    UploadXhr.auto = () => 'network';
    await openThread();
    pickPhotos([image('a.webp')]);
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    is44(await screen.findByRole('button', { name: 'Retry sending this message' }));
    is44(screen.getByRole('button', { name: 'Remove this message that was not sent' }));
  });

  it('gives the quick questions 44px', async () => {
    route({ messages: [] });
    render(<SupportWidget />);
    openSupport({});
    const list = await screen.findByRole('list', { name: 'Common questions' });
    for (const chip of within(list).getAllByRole('button')) is44(chip);
  });
});
