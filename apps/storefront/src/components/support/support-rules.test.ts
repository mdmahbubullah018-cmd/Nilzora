import type { ChatMessage } from '@nilzora/contracts';
import { describe, expect, it } from 'vitest';
import {
  canReportMessage,
  feedbackTargetId,
  isReactable,
  isSupportReply,
  isSyntheticAttachmentBody,
  listPreview,
  looksLikeFileNames,
  previewLine,
  visibleBody,
} from './support-model';
import {
  computePlacement,
  overlayMaxHeight,
  REACTION_TARGET,
  reactionGrid,
} from './support-placement';

const AGENT = '22222222-2222-4222-8222-222222222222';

function message(seq: number, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    seq,
    senderId: AGENT,
    senderRole: 'staff',
    senderName: null,
    kind: 'text',
    body: `Message ${String(seq)}`,
    replyToId: null,
    metadata: {},
    editedAt: null,
    createdAt: '2026-11-08T10:00:00.000Z',
    attachments: [],
    ...overrides,
  };
}

const FILE = (fileName: string) => ({
  id: '77777777-7777-4777-8777-777777777777',
  fileName,
  contentType: 'image/webp',
  byteSize: 10,
  width: null,
  height: null,
  durationMs: null,
  url: null,
  thumbnailUrl: null,
});

describe('which messages react, report and copy', () => {
  it('reacts to people and the assistant, never to timeline rows', () => {
    expect(isReactable({ kind: 'text' })).toBe(true);
    expect(isReactable({ kind: 'automated' })).toBe(true);
    expect(isReactable({ kind: 'system' })).toBe(false);
    expect(isReactable({ kind: 'order_event' })).toBe(false);
  });

  it('reports only what someone else wrote', () => {
    expect(canReportMessage({ kind: 'text', senderRole: 'staff' })).toBe(true);
    expect(canReportMessage({ kind: 'automated', senderRole: 'staff' })).toBe(true);
    expect(canReportMessage({ kind: 'text', senderRole: 'customer' })).toBe(false);
    expect(canReportMessage({ kind: 'system', senderRole: 'staff' })).toBe(false);
    expect(canReportMessage({ kind: 'order_event', senderRole: 'system' })).toBe(false);
    expect(isSupportReply({ kind: 'text', senderRole: 'system' })).toBe(false);
  });

  it('lets a customer report the Nilzora Assistant, which is sent as the system role', () => {
    expect(canReportMessage({ kind: 'automated', senderRole: 'system' })).toBe(true);
    // Still not the assistant "speaking" as the customer, nor timeline pills or order events.
    expect(canReportMessage({ kind: 'automated', senderRole: 'customer' })).toBe(false);
    expect(canReportMessage({ kind: 'system', senderRole: 'system' })).toBe(false);
    expect(canReportMessage({ kind: 'order_event', senderRole: 'system' })).toBe(false);
    // The helpfulness prompt keeps its own, narrower rule.
    expect(isSupportReply({ kind: 'automated', senderRole: 'system' })).toBe(false);
  });
});

describe('the synthetic file-name body', () => {
  it('is hidden when it is exactly the attachment names joined by a comma', () => {
    const attachments = [FILE('photo-123.webp'), FILE('invoice.pdf')];
    expect(isSyntheticAttachmentBody('photo-123.webp, invoice.pdf', attachments)).toBe(true);
    expect(visibleBody({ body: 'photo-123.webp, invoice.pdf', attachments })).toBe('');
  });

  it('keeps a caption the customer really wrote', () => {
    const attachments = [FILE('photo-123.webp')];
    expect(visibleBody({ body: 'The box was dented', attachments })).toBe('The box was dented');
    // Only a body identical to the names is bookkeeping: a name inside a sentence is text.
    expect(visibleBody({ body: 'See photo-123.webp', attachments })).toBe('See photo-123.webp');
    // Without attachments a file-like body is just text.
    expect(visibleBody({ body: 'photo-123.webp', attachments: [] })).toBe('photo-123.webp');
  });

  it('recognises a name list in a quote or list preview, where the files are not known', () => {
    expect(looksLikeFileNames('photo-123.webp')).toBe(true);
    expect(looksLikeFileNames('photo-123.webp, invoice.pdf')).toBe(true);
    expect(looksLikeFileNames('Where is my parcel.')).toBe(false);
    expect(previewLine({ body: 'photo-123.webp', hasAttachment: true })).toBe('Attachment');
    expect(previewLine({ body: 'Two days.', hasAttachment: true })).toBe('Two days.');
    expect(previewLine({ body: null, hasAttachment: false, deleted: true })).toBe(
      'Message unavailable',
    );
    expect(listPreview('photo-123.webp')).toBe('Attachment');
    expect(listPreview(null)).toBe('No messages yet');
    expect(listPreview('How long?')).toBe('How long?');
  });
});

describe('when "Was this helpful?" may be asked', () => {
  const base = {
    messages: [message(1, { senderRole: 'customer' }), message(2)],
    resolvedAt: '2026-11-08T11:00:00.000Z',
    lastCustomerMessageAt: '2026-11-08T10:00:00.000Z',
  };

  it('asks nothing while the conversation is open or in progress', () => {
    expect(feedbackTargetId({ ...base, status: 'open' })).toBeNull();
    expect(feedbackTargetId({ ...base, status: 'pending' })).toBeNull();
    expect(feedbackTargetId({ ...base, status: null })).toBeNull();
  });

  it('asks about the last real reply, when resolved or closed', () => {
    const messages = [message(2), message(4), message(5, { senderRole: 'customer' })];
    expect(feedbackTargetId({ ...base, messages, status: 'resolved' })).toBe(messages[1]?.id);
    expect(feedbackTargetId({ ...base, messages, status: 'closed' })).toBe(messages[1]?.id);
  });

  it('skips system rows and order events when looking for the last reply', () => {
    const messages = [
      message(2),
      message(3, { kind: 'system', senderRole: 'system' }),
      message(4, { kind: 'order_event' }),
    ];
    expect(feedbackTargetId({ ...base, messages, status: 'resolved' })).toBe(messages[0]?.id);
    expect(
      feedbackTargetId({
        ...base,
        messages: [message(3, { kind: 'system', senderRole: 'system' })],
        status: 'resolved',
      }),
    ).toBeNull();
  });

  it('stops asking a resolved thread once the customer wrote after it was resolved', () => {
    expect(
      feedbackTargetId({
        ...base,
        status: 'resolved',
        lastCustomerMessageAt: '2026-11-08T12:00:00.000Z',
      }),
    ).toBeNull();
    // Written at the same instant it was resolved still counts as before.
    expect(
      feedbackTargetId({
        ...base,
        status: 'resolved',
        lastCustomerMessageAt: '2026-11-08T11:00:00.000Z',
      }),
    ).not.toBeNull();
  });
});

describe('floating placement', () => {
  const viewport = { width: 400, height: 700 };
  const popup = { width: 330, height: 48 };

  it('opens above the bubble when there is room', () => {
    const placed = computePlacement({
      anchor: { top: 300, left: 100, width: 180, height: 60 },
      popup,
      viewport,
    });
    expect(placed.side).toBe('above');
    expect(placed.top).toBeLessThan(300);
  });

  it('flips below when the bubble is at the top edge', () => {
    const placed = computePlacement({
      anchor: { top: 20, left: 100, width: 180, height: 60 },
      popup,
      viewport,
    });
    expect(placed.side).toBe('below');
    expect(placed.top).toBeGreaterThanOrEqual(80);
  });

  it('never leaves the viewport, however far the bubble sits to the side', () => {
    for (const left of [-50, 0, 90, 380]) {
      const placed = computePlacement({
        anchor: { top: 300, left, width: 80, height: 40 },
        popup,
        viewport,
      });
      expect(placed.left).toBeGreaterThanOrEqual(8);
      expect(placed.left + popup.width).toBeLessThanOrEqual(viewport.width - 8);
      expect(placed.top).toBeGreaterThanOrEqual(8);
      expect(placed.top + popup.height).toBeLessThanOrEqual(viewport.height - 8);
    }
  });

  it('keeps a popup wider than the viewport at the left margin', () => {
    const placed = computePlacement({
      anchor: { top: 300, left: 100, width: 80, height: 40 },
      popup: { width: 500, height: 48 },
      viewport,
    });
    expect(placed.left).toBe(8);
  });

  it('prefers below for a menu and above only when that does not fit', () => {
    const menu = { width: 200, height: 200 };
    const below = computePlacement({
      anchor: { top: 100, left: 20, width: 100, height: 40 },
      popup: menu,
      viewport,
      prefer: 'below',
    });
    const flipped = computePlacement({
      anchor: { top: 620, left: 20, width: 100, height: 40 },
      popup: menu,
      viewport,
      prefer: 'below',
    });
    expect(below.side).toBe('below');
    expect(flipped.side).toBe('above');
  });
});

describe('reaction bar grid', () => {
  const MARGIN = 12;
  const CHROME = 10;

  it('keeps every button 44 px', () => {
    expect(REACTION_TARGET).toBe(44);
  });

  it.each([
    [320, 4, 2],
    [360, 4, 2],
    [390, 8, 1],
    [412, 8, 1],
    [768, 8, 1],
    [1280, 8, 1],
  ])('at %i px wide: %i columns x %i rows', (width, columns, rows) => {
    expect(reactionGrid({ count: 8, viewportWidth: width, margin: MARGIN })).toEqual({
      columns,
      rows,
    });
  });

  it.each([320, 360, 390, 412, 768, 1280])(
    'the bar at %i px wide fits between both margins',
    (width) => {
      const { columns } = reactionGrid({ count: 8, viewportWidth: width, margin: MARGIN });
      expect(columns * REACTION_TARGET + CHROME).toBeLessThanOrEqual(width - 2 * MARGIN);
    },
  );

  it('uses the fewest rows and balances them instead of leaving an orphan row', () => {
    // 6 buttons fit across 320 px, but 6 + 2 would strand two; 4 + 4 is the balanced layout.
    const grid = reactionGrid({ count: 8, viewportWidth: 320, margin: MARGIN });
    expect(grid.columns * grid.rows).toBe(8);
  });

  it('degrades to a single column on an impossibly narrow viewport rather than shrinking buttons', () => {
    expect(reactionGrid({ count: 8, viewportWidth: 40, margin: MARGIN })).toEqual({
      columns: 1,
      rows: 8,
    });
  });
});

describe('stacked reaction bar + menu on short viewports', () => {
  const MARGIN = 12;

  it('caps the unit at the viewport less both margins', () => {
    expect(overlayMaxHeight(500, MARGIN)).toBe(476);
    expect(overlayMaxHeight(10, MARGIN)).toBe(0);
  });

  it.each([
    [320, 480],
    [360, 640],
    [390, 300],
    [412, 260],
    [768, 1024],
    [1280, 720],
  ])('keeps the unit inside a %i x %i viewport wherever the bubble is', (width, height) => {
    const { columns } = reactionGrid({ count: 8, viewportWidth: width, margin: MARGIN });
    const barHeight = Math.ceil(8 / columns) * REACTION_TARGET + 10;
    const menuHeight = 4 * 44 + 2;
    const cap = overlayMaxHeight(height, MARGIN);
    // The unit is the bar, a gap and the menu, capped: a menu that cannot fit scrolls inside it.
    const unit = {
      width: Math.max(columns * REACTION_TARGET + 10, 208),
      height: Math.min(barHeight + 6 + menuHeight, cap),
    };
    for (const top of [0, height / 2, height - 40]) {
      for (const left of [0, width / 2, width - 80]) {
        const placed = computePlacement({
          anchor: { top, left, width: 80, height: 40 },
          popup: unit,
          viewport: { width, height },
          margin: MARGIN,
          prefer: 'above',
        });
        expect(placed.top).toBeGreaterThanOrEqual(MARGIN);
        expect(placed.left).toBeGreaterThanOrEqual(MARGIN);
        expect(placed.top + unit.height).toBeLessThanOrEqual(height - MARGIN);
        expect(placed.left + unit.width).toBeLessThanOrEqual(width - MARGIN);
      }
    }
  });

  it('places the bar and menu as one block: the second never starts inside the first', () => {
    // Bar (92 high) then a 6 px gap then the menu, from one top coordinate.
    const placed = computePlacement({
      anchor: { top: 30, left: 100, width: 120, height: 40 },
      popup: { width: 208, height: 92 + 6 + 178 },
      viewport: { width: 360, height: 640 },
      margin: 12,
      prefer: 'above',
    });
    // Too close to the top to sit above, so the whole unit flips underneath the bubble together.
    expect(placed.side).toBe('below');
    expect(placed.top).toBeGreaterThanOrEqual(70);
  });
});
