import type { ChatMessage } from '@nilzora/contracts';
import {
  computeMenuLayout,
  feedbackTargetId,
  isReactable,
  isReportable,
  isReplyable,
  previewText,
  quoteSnippet,
  REACTION_TARGET,
  reactionBarGrid,
  visibleBody,
  visibleSnippet,
} from '@/features/support/message-model';

function message(overrides: Partial<ChatMessage> & { seq: number }): ChatMessage {
  return {
    id: `00000000-0000-4000-8000-${String(overrides.seq).padStart(12, '0')}`,
    senderId: '00000000-0000-4000-8000-0000000000aa',
    senderRole: 'staff',
    senderName: 'Rumana',
    kind: 'text',
    body: 'Hello',
    replyToId: null,
    metadata: {},
    editedAt: null,
    createdAt: '2026-11-05T10:00:00.000Z',
    attachments: [],
    ...overrides,
  };
}

describe('which messages take which actions', () => {
  it('lets every bubble take a reaction and a reply, but not platform lines', () => {
    for (const kind of ['text', 'automated'] as const) {
      expect(isReactable({ kind })).toBe(true);
      expect(isReplyable({ kind })).toBe(true);
    }
    for (const kind of ['system', 'order_event'] as const) {
      expect(isReactable({ kind })).toBe(false);
      expect(isReplyable({ kind })).toBe(false);
    }
  });

  it('reports only what the other side wrote', () => {
    expect(isReportable({ kind: 'text', senderRole: 'staff' })).toBe(true);
    expect(isReportable({ kind: 'automated', senderRole: 'system' })).toBe(true);
    expect(isReportable({ kind: 'text', senderRole: 'customer' })).toBe(false);
    expect(isReportable({ kind: 'system', senderRole: 'system' })).toBe(false);
    expect(isReportable({ kind: 'order_event', senderRole: 'system' })).toBe(false);
  });
});

describe('the synthetic body of an attachment-only message', () => {
  const files = [{ fileName: 'a.webp' }, { fileName: 'b.pdf' }];

  it('is hidden when it equals the attachments names joined with a comma', () => {
    expect(visibleBody({ body: 'a.webp, b.pdf', attachments: files })).toBeNull();
  });

  it('keeps words the customer really wrote, even alongside files', () => {
    expect(visibleBody({ body: 'Here you go', attachments: files })).toBe('Here you go');
    expect(visibleBody({ body: 'a.webp', attachments: files })).toBe('a.webp');
    expect(visibleBody({ body: 'a.webp, b.pdf', attachments: [] })).toBe('a.webp, b.pdf');
  });

  it('is hidden in quotes and previews that only know a message has an attachment', () => {
    expect(visibleSnippet('receipt.webp, invoice.pdf', true)).toBeNull();
    expect(visibleSnippet('Please see invoice.pdf now', true)).toBe('Please see invoice.pdf now');
    expect(visibleSnippet('receipt.webp', false)).toBe('receipt.webp');
    expect(previewText('receipt.webp')).toBe('Attachment');
    expect(previewText('Thanks!')).toBe('Thanks!');
    expect(previewText(null)).toBe('No messages yet');
  });

  it('shows "Attachment" in a reply quote instead of the file names', () => {
    const base = {
      id: '00000000-0000-4000-8000-000000000001',
      seq: 1,
      senderId: null,
      senderRole: 'customer' as const,
      senderName: null,
      kind: 'text' as const,
      deleted: false,
    };
    expect(quoteSnippet({ ...base, body: 'shot.webp', hasAttachment: true })).toBe('Attachment');
    expect(quoteSnippet({ ...base, body: 'Hi\nthere', hasAttachment: false })).toBe('Hi');
    expect(quoteSnippet({ ...base, body: null, hasAttachment: false, deleted: true })).toBe(
      'Message unavailable',
    );
  });
});

describe('"Was this helpful?" gating', () => {
  const customer = message({ seq: 1, senderRole: 'customer', body: 'Where is it?' });
  const reply = message({ seq: 2, body: 'On its way' });
  const laterReply = message({ seq: 3, body: 'Anything else?' });
  const thread = [customer, reply, laterReply];
  const none = new Set<string>();
  const resolved = {
    status: 'resolved' as const,
    resolvedAt: '2026-11-05T11:00:00.000Z',
    lastCustomerMessageAt: '2026-11-05T10:30:00.000Z',
  };

  it('asks only about the last real support reply of a resolved thread', () => {
    expect(feedbackTargetId(resolved, thread, none)).toBe(laterReply.id);
  });

  it('asks for a closed thread too, even without a resolved time', () => {
    expect(
      feedbackTargetId(
        { status: 'closed', resolvedAt: null, lastCustomerMessageAt: null },
        thread,
        none,
      ),
    ).toBe(laterReply.id);
  });

  it('never asks while the thread is open or pending', () => {
    for (const status of ['open', 'pending'] as const) {
      expect(feedbackTargetId({ ...resolved, status }, thread, none)).toBeNull();
    }
  });

  it('stops asking once the customer wrote after the thread was resolved', () => {
    expect(
      feedbackTargetId(
        { ...resolved, lastCustomerMessageAt: '2026-11-05T11:30:00.000Z' },
        thread,
        none,
      ),
    ).toBeNull();
  });

  it('is hidden once the customer has a verdict for that reply', () => {
    expect(feedbackTargetId(resolved, thread, new Set([laterReply.id]))).toBeNull();
  });

  it('skips automation, system lines and order events to find a real reply', () => {
    const noise = [
      reply,
      message({ seq: 3, kind: 'automated', senderRole: 'system', senderName: null }),
      message({ seq: 4, kind: 'system', senderRole: 'system' }),
      message({ seq: 5, kind: 'order_event', senderRole: 'system' }),
    ];
    expect(feedbackTargetId(resolved, noise, none)).toBe(reply.id);
  });

  it('has no target when staff never replied or nothing is known yet', () => {
    expect(feedbackTargetId(resolved, [customer], none)).toBeNull();
    expect(feedbackTargetId(null, thread, none)).toBeNull();
    expect(feedbackTargetId({ ...resolved, resolvedAt: null }, thread, none)).toBeNull();
  });
});

describe('where the long-press menu goes', () => {
  const window = { width: 360, height: 800 };
  const insets = { top: 24, bottom: 16, left: 0, right: 0 };
  const bar = { width: 336, height: 52 };
  const list = { width: 224, height: 200 };

  function inside(layout: ReturnType<typeof computeMenuLayout>) {
    expect(layout.bar.x).toBeGreaterThanOrEqual(0);
    expect(layout.bar.x + bar.width).toBeLessThanOrEqual(window.width);
    expect(layout.list.x).toBeGreaterThanOrEqual(0);
    expect(layout.list.x + list.width).toBeLessThanOrEqual(window.width);
    expect(layout.bar.y).toBeGreaterThanOrEqual(insets.top);
    expect(layout.list.y + list.height).toBeLessThanOrEqual(window.height - insets.bottom);
    // The two never overlap.
    expect(layout.list.y).toBeGreaterThanOrEqual(layout.bar.y + bar.height);
  }

  it('puts the bar above the bubble and the list below it', () => {
    const anchor = { x: 40, y: 400, width: 200, height: 60 };
    const layout = computeMenuLayout({ anchor, window, insets, mine: false, bar, list });
    expect(layout.bar.y + bar.height).toBeLessThanOrEqual(anchor.y);
    expect(layout.list.y).toBeGreaterThanOrEqual(anchor.y + anchor.height);
    inside(layout);
  });

  it('moves the bar under a bubble that sits at the very top', () => {
    const anchor = { x: 40, y: 30, width: 200, height: 60 };
    const layout = computeMenuLayout({ anchor, window, insets, mine: false, bar, list });
    expect(layout.bar.y).toBeGreaterThanOrEqual(anchor.y + anchor.height);
    inside(layout);
  });

  it('slides the pair up for a bubble at the very bottom', () => {
    const anchor = { x: 40, y: 700, width: 200, height: 60 };
    inside(computeMenuLayout({ anchor, window, insets, mine: false, bar, list }));
  });

  it('keeps a wide bar on screen for a bubble pressed against either edge', () => {
    const left = computeMenuLayout({
      anchor: { x: 0, y: 400, width: 120, height: 40 },
      window,
      insets,
      mine: false,
      bar,
      list,
    });
    const right = computeMenuLayout({
      anchor: { x: 250, y: 400, width: 110, height: 40 },
      window,
      insets,
      mine: true,
      bar,
      list,
    });
    inside(left);
    inside(right);
  });

  it('stays inside the screen for a bubble taller than the screen', () => {
    inside(
      computeMenuLayout({
        anchor: { x: 20, y: -300, width: 300, height: 1400 },
        window,
        insets,
        mine: true,
        bar,
        list,
      }),
    );
  });
});

describe('the reaction bar grid', () => {
  const MARGIN = 12;
  const PADDING = 4;

  it('keeps every button a 44 dp square', () => {
    expect(REACTION_TARGET).toBe(44);
  });

  it.each([
    [320, 4, 2],
    [360, 4, 2],
    [390, 8, 1],
    [412, 8, 1],
    [600, 8, 1],
    [768, 8, 1],
  ])('on a %i dp wide screen: %i columns x %i rows', (width, columns, rows) => {
    const grid = reactionBarGrid({ count: 8, available: width - MARGIN * 2, padding: PADDING });
    expect({ columns: grid.columns, rows: grid.rows }).toEqual({ columns, rows });
    expect(grid.item).toBe(44);
    // The bar fits between both margins and is exactly as tall as its rows need.
    expect(grid.width).toBeLessThanOrEqual(width - MARGIN * 2);
    expect(grid.width).toBe(columns * 44 + PADDING * 2);
    expect(grid.height).toBe(rows * 44 + PADDING * 2);
  });

  it('balances the rows rather than stranding one reaction on a second line', () => {
    // 7 buttons fit across 360 dp, but 7 + 1 is lopsided: 4 + 4 is used.
    const grid = reactionBarGrid({ count: 8, available: 360 - MARGIN * 2, padding: PADDING });
    expect(grid.columns * grid.rows).toBe(8);
  });

  it('falls back to a single column rather than shrinking the buttons', () => {
    const grid = reactionBarGrid({ count: 8, available: 30, padding: PADDING });
    expect(grid).toMatchObject({ columns: 1, rows: 8, item: 44 });
  });
});

describe('the long-press menu on short screens and every common width', () => {
  const insets = { top: 24, bottom: 16, left: 0, right: 0 };
  const MARGIN = 12;
  const LIST_ROWS = 4;
  const listFor = (width: number) => ({
    width: Math.min(224, width - MARGIN * 2),
    height: LIST_ROWS * 48 + 8,
  });

  function expectInside(
    layout: ReturnType<typeof computeMenuLayout>,
    win: { width: number; height: number },
    bar: { width: number; height: number },
    list: { width: number },
  ) {
    expect(layout.bar.x).toBeGreaterThanOrEqual(MARGIN);
    expect(layout.bar.x + bar.width).toBeLessThanOrEqual(win.width - MARGIN);
    expect(layout.list.x).toBeGreaterThanOrEqual(MARGIN);
    expect(layout.list.x + list.width).toBeLessThanOrEqual(win.width - MARGIN);
    expect(layout.bar.y).toBeGreaterThanOrEqual(insets.top + MARGIN);
    expect(layout.list.y + layout.list.height).toBeLessThanOrEqual(
      win.height - insets.bottom - MARGIN,
    );
    // Whatever order they are in, the bar and the list never overlap.
    const barEnd = layout.bar.y + bar.height;
    const listEnd = layout.list.y + layout.list.height;
    expect(layout.list.y >= barEnd || layout.bar.y >= listEnd).toBe(true);
  }

  it.each([
    [320, 640],
    [360, 780],
    [390, 844],
    [412, 915],
    [600, 960],
  ])('stays inside a %i x %i screen for a bubble anywhere on it', (width, height) => {
    const win = { width, height };
    const grid = reactionBarGrid({ count: 8, available: width - MARGIN * 2, padding: 4 });
    const bar = { width: grid.width, height: grid.height };
    const list = listFor(width);
    for (const y of [-40, 40, height / 2, height - 90, height - 20]) {
      for (const [x, mine] of [
        [0, false],
        [width - 120, true],
      ] as const) {
        const layout = computeMenuLayout({
          anchor: { x, y, width: 120, height: 50 },
          window: win,
          insets,
          mine,
          bar,
          list,
        });
        expectInside(layout, win, bar, list);
        // Nothing needed shortening on a normal screen.
        expect(layout.list.height).toBe(list.height);
      }
    }
  });

  it.each([
    [360, 300],
    [360, 240],
    [412, 260],
    [320, 200],
  ])('on a short %i x %i screen the list shrinks and scrolls instead of overlapping', (w, h) => {
    const win = { width: w, height: h };
    const grid = reactionBarGrid({ count: 8, available: w - MARGIN * 2, padding: 4 });
    const bar = { width: grid.width, height: grid.height };
    const list = listFor(w);
    for (const y of [0, h / 2, h - 60]) {
      const layout = computeMenuLayout({
        anchor: { x: 20, y, width: 150, height: 50 },
        window: win,
        insets,
        mine: false,
        bar,
        list,
      });
      expectInside(layout, win, bar, list);
      expect(layout.list.height).toBeLessThanOrEqual(list.height);
      expect(layout.list.height).toBeGreaterThanOrEqual(0);
    }
  });

  it('stacks bar then list as one block under the bubble when the bar has no room above', () => {
    const bar = { width: 184, height: 96 };
    const list = { width: 224, height: 200 };
    const layout = computeMenuLayout({
      anchor: { x: 20, y: 40, width: 150, height: 50 },
      window: { width: 360, height: 800 },
      insets,
      mine: false,
      bar,
      list,
    });
    expect(layout.bar.y).toBe(40 + 50 + 8);
    expect(layout.list.y).toBe(layout.bar.y + bar.height + 8);
  });

  it('puts the whole block above a bubble at the bottom instead of sliding it over the bubble', () => {
    const bar = { width: 184, height: 96 };
    const list = { width: 224, height: 200 };
    const anchor = { x: 20, y: 640, width: 150, height: 50 };
    const layout = computeMenuLayout({
      anchor,
      window: { width: 360, height: 800 },
      insets,
      mine: false,
      bar,
      list,
    });
    expect(layout.list.y + layout.list.height).toBeLessThanOrEqual(anchor.y);
    expect(layout.bar.y + bar.height).toBeLessThanOrEqual(layout.list.y);
  });

  it('handles a menu with no reaction bar', () => {
    const layout = computeMenuLayout({
      anchor: { x: 20, y: 300, width: 150, height: 50 },
      window: { width: 360, height: 800 },
      insets,
      mine: false,
      bar: { width: 0, height: 0 },
      list: { width: 224, height: 200 },
    });
    expect(layout.list.y).toBe(358);
    expect(layout.list.height).toBe(200);
  });
});
