import {
  CHAT_DOCUMENT_TYPES,
  CHAT_DOCUMENT_MAX_BYTES,
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_TYPES,
  type ChatReactionSummaryItem,
} from '@nilzora/contracts';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachMenuButton, SelectedFileList, checkChosenFile } from './support-attach';
import { CsatPrompt, MessageFeedbackPrompt, ReplyQuote } from './support-extras';
import { AskSupportButton } from './ask-support-button';
import {
  ReactionBar,
  ReactionSummaryRow,
  ReactionsProvider,
  applyToggle,
  rowsFromResponse,
  useReactions,
} from './support-reactions';
import type { SelectedChatFile } from './support-upload';

/*
 * The widget's smaller pieces, each on its own: the attach menu and its validation, the preview
 * chips, the feedback prompt, and the thread-wide reactions store with its bar and counts.
 * `fetch` is the whole browser boundary here.
 */

const MEGABYTE = 1024 * 1024;
const CONVERSATION = '44444444-4444-4444-8444-444444444444';
const MESSAGE_A = '55555555-5555-4555-8555-555555555551';
const MESSAGE_B = '55555555-5555-4555-8555-555555555552';
const MESSAGE_C = '55555555-5555-4555-8555-555555555553';

const fetchMock = vi.fn<typeof fetch>();

function file(name: string, size: number, type: string): File {
  return new File([new Uint8Array(new ArrayBuffer(size))], name, { type });
}

function json(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------------------------
// The attach menu
// ---------------------------------------------------------------------------------------------

function renderMenu(
  options: {
    count?: number;
    onAdd?: (files: { file: File; durationMs: number | null }[]) => void;
    onProblems?: (problems: string[]) => void;
    disabled?: boolean;
  } = {},
) {
  const view = render(
    <AttachMenuButton
      count={options.count ?? 0}
      onAdd={options.onAdd ?? vi.fn()}
      onProblems={options.onProblems ?? vi.fn()}
      disabled={options.disabled ?? false}
    />,
  );
  const input = (label: string) =>
    view.container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  return { view, input };
}

function openMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Attach a photo or file' }));
}

function choose(input: HTMLInputElement | null, chosen: File[]): void {
  if (input === null) throw new Error('input missing');
  fireEvent.change(input, { target: { files: chosen } });
}

describe('AttachMenuButton', () => {
  it('is one control that opens a compact menu of Photos and Files only', () => {
    renderMenu();
    expect(screen.queryByRole('menu')).toBeNull();
    openMenu();
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    // No Camera without a touch screen, and no "Record voice": the microphone is beside Send.
    expect(items).toEqual(['Photos', 'Files']);
  });

  it('offers Camera only where capture is meaningful, and opens the camera input', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const { input } = renderMenu();
    openMenu();
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Photos',
      'Files',
      'Camera',
    ]);
    const camera = input('Take a photo');
    expect(camera?.getAttribute('capture')).toBe('environment');
    expect(camera?.getAttribute('accept')).toBe(CHAT_IMAGE_TYPES.join(','));
  });

  it('restricts Photos to the picture types and Files to the document types', () => {
    const { input } = renderMenu();
    expect(input('Choose photos')?.getAttribute('accept')).toBe(CHAT_IMAGE_TYPES.join(','));
    expect(input('Choose files')?.getAttribute('accept')).toBe(CHAT_DOCUMENT_TYPES.join(','));
    expect(input('Choose photos')?.hasAttribute('multiple')).toBe(true);
    expect(input('Take a photo')).toBeNull();
  });

  it('hands chosen files over locally and requests nothing', () => {
    const onAdd = vi.fn();
    const onProblems = vi.fn();
    const { input } = renderMenu({ onAdd, onProblems });

    choose(input('Choose photos'), [file('parcel.webp', 4096, 'image/webp')]);
    choose(input('Choose files'), [file('invoice.pdf', 2048, 'application/pdf')]);

    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(onProblems).toHaveBeenLastCalledWith([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a picture above 10 MB and a document above 20 MB, naming each', () => {
    const onAdd = vi.fn();
    const onProblems = vi.fn();
    const { input } = renderMenu({ onAdd, onProblems });

    choose(input('Choose photos'), [file('huge.webp', CHAT_IMAGE_MAX_BYTES + 1, 'image/webp')]);
    expect(onProblems).toHaveBeenLastCalledWith(['huge.webp is larger than 10 MB.']);
    choose(input('Choose files'), [
      file('scan.pdf', CHAT_DOCUMENT_MAX_BYTES + 1, 'application/pdf'),
    ]);
    expect(onProblems).toHaveBeenLastCalledWith(['scan.pdf is larger than 20 MB.']);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('accepts sizes under the ceilings', () => {
    const onAdd = vi.fn();
    const { input } = renderMenu({ onAdd });
    choose(input('Choose photos'), [file('big.webp', 9 * MEGABYTE, 'image/webp')]);
    choose(input('Choose files'), [file('scan.pdf', 15 * MEGABYTE, 'application/pdf')]);
    expect(onAdd).toHaveBeenCalledTimes(2);
  });

  it('refuses an unsupported type, an audio file and an empty file with a clear sentence', () => {
    const onAdd = vi.fn();
    const onProblems = vi.fn();
    const { input } = renderMenu({ onAdd, onProblems });
    choose(input('Choose files'), [
      file('setup.exe', 1024, 'application/x-msdownload'),
      file('clip.webm', 1024, 'audio/webm'),
      file('empty.pdf', 0, 'application/pdf'),
    ]);
    expect(onAdd).not.toHaveBeenCalled();
    const problems = onProblems.mock.calls.at(-1)?.[0] as string[];
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/setup\.exe: Attach a JPEG, PNG or WebP picture/);
    expect(problems[1]).toMatch(/clip\.webm/);
    expect(problems[2]).toBe('empty.pdf is empty.');
    expect(checkChosenFile(file('a.csv', 10, 'text/csv'))).toEqual({
      file: expect.any(File) as File,
      durationMs: null,
    });
  });

  it('stops at five files per message and says so instead of dropping silently', () => {
    const onAdd = vi.fn();
    const onProblems = vi.fn();
    const { input } = renderMenu({ onAdd, onProblems, count: 3 });
    choose(
      input('Choose photos'),
      Array.from({ length: 4 }, (_, index) => file(`p${String(index)}.webp`, 1024, 'image/webp')),
    );
    expect((onAdd.mock.calls[0]?.[0] as unknown[]).length).toBe(2);
    expect(onProblems).toHaveBeenLastCalledWith(['A message carries at most 5 files.']);
  });

  it('is disabled once the message already carries five files', () => {
    renderMenu({ count: 5 });
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Attach a photo or file' }).disabled,
    ).toBe(true);
  });

  it('closes on Escape and on a press outside', () => {
    renderMenu();
    openMenu();
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    openMenu();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Preview chips
// ---------------------------------------------------------------------------------------------

function entry(overrides: Partial<SelectedChatFile> = {}): SelectedChatFile {
  return {
    localId: 'local-1',
    file: file('parcel.webp', 2048, 'image/webp'),
    name: 'parcel.webp',
    kind: 'image',
    durationMs: null,
    ...overrides,
  };
}

describe('SelectedFileList', () => {
  it('shows an image thumbnail from a local object URL and releases it on removal', () => {
    const create = vi.fn(() => 'blob:parcel');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const { container, unmount } = render(
      <SelectedFileList
        selected={[entry()]}
        onRemove={vi.fn()}
        onClear={vi.fn()}
        disabled={false}
      />,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:parcel');
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:parcel');
  });

  it('shows a document by name, type and size, with no thumbnail', () => {
    const { container } = render(
      <SelectedFileList
        selected={[
          entry({
            localId: 'doc',
            file: file('invoice.pdf', 40_960, 'application/pdf'),
            name: 'invoice.pdf',
            kind: 'document',
          }),
        ]}
        onRemove={vi.fn()}
        onClear={vi.fn()}
        disabled={false}
      />,
    );
    expect(screen.getByText('invoice.pdf')).toBeTruthy();
    expect(screen.getByText(/PDF · 40 KB/)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });

  it('removes one file or all of them before sending, without any request', () => {
    const onRemove = vi.fn();
    const onClear = vi.fn();
    render(
      <SelectedFileList
        selected={[entry(), entry({ localId: 'local-2', name: 'second.webp' })]}
        onRemove={onRemove}
        onClear={onClear}
        disabled={false}
      />,
    );
    expect(screen.getByText('2 of 5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove parcel.webp' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onRemove).toHaveBeenCalledWith('local-1');
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------------------------

describe('ReplyQuote', () => {
  it('does not quote the synthetic file-name body of an attachment-only message', () => {
    render(
      <ReplyQuote
        reply={{
          id: MESSAGE_A,
          seq: 1,
          senderId: null,
          senderRole: 'staff',
          senderName: 'Staff One',
          kind: 'text',
          body: 'photo-123.webp',
          hasAttachment: true,
          deleted: false,
        }}
      />,
    );
    expect(screen.getByText('Attachment')).toBeTruthy();
    expect(screen.queryByText('photo-123.webp')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Per-reply feedback
// ---------------------------------------------------------------------------------------------

describe('MessageFeedbackPrompt', () => {
  it('has Yes and No and no "Add a note"', () => {
    render(<MessageFeedbackPrompt messageId={MESSAGE_A} verdict={null} onVerdict={vi.fn()} />);
    expect(screen.getByText('Was this helpful?')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Yes/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /No/ })).toBeTruthy();
    expect(screen.queryByText(/note/i)).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('sends only the verdict and reports the one the API stored', async () => {
    fetchMock.mockImplementation(() =>
      json({
        id: MESSAGE_B,
        messageId: MESSAGE_A,
        verdict: 'not_helpful',
        comment: null,
        createdAt: '',
        updatedAt: '',
      }),
    );
    const onVerdict = vi.fn();
    render(<MessageFeedbackPrompt messageId={MESSAGE_A} verdict={null} onVerdict={onVerdict} />);
    fireEvent.click(screen.getByRole('button', { name: /No/ }));

    await waitFor(() => expect(onVerdict).toHaveBeenCalledWith('not_helpful'));
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(body).toEqual({ op: 'message-feedback', messageId: MESSAGE_A, verdict: 'not_helpful' });
    expect(await screen.findByText(/Thanks/)).toBeTruthy();
  });

  it('shows nothing for a reply that already has a verdict', () => {
    const { container } = render(
      <MessageFeedbackPrompt messageId={MESSAGE_A} verdict="helpful" onVerdict={vi.fn()} />,
    );
    expect(container.textContent).toBe('');
  });

  it('keeps asking, with the reason, when saving failed', async () => {
    fetchMock.mockImplementation(() =>
      json({ error: { code: 'unavailable', message: 'Nilzora is offline.' } }, 503),
    );
    const onVerdict = vi.fn();
    render(<MessageFeedbackPrompt messageId={MESSAGE_A} verdict={null} onVerdict={onVerdict} />);
    fireEvent.click(screen.getByRole('button', { name: /Yes/ }));
    expect((await screen.findByRole('alert')).textContent).toBe('Nilzora is offline.');
    expect(onVerdict).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Yes/ })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------
// Reactions
// ---------------------------------------------------------------------------------------------

function row(
  messageId: string,
  emoji: string,
  count: number,
  mine: boolean,
): ChatReactionSummaryItem {
  return { messageId, emoji, count, mine };
}

function Thread({ ids }: { ids: string[] }) {
  return (
    <>
      {ids.map((id) => (
        <div key={id} data-testid={`row-${id}`}>
          <ReactionSummaryRow messageId={id} align="start" />
          <Chooser id={id} />
        </div>
      ))}
    </>
  );
}

function Chooser({ id }: { id: string }) {
  const reactions = useReactions();
  return <ReactionBar messageId={id} onChoose={(emoji) => void reactions.toggle(id, emoji)} />;
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

function reactionReads(): number {
  return fetchMock.mock.calls.filter(([url]) => urlOf(url).includes('op=reactions')).length;
}

function reactionPosts(): Record<string, unknown>[] {
  return fetchMock.mock.calls
    .map(([, init]) => init?.body)
    .filter((body): body is string => typeof body === 'string')
    .map((body) => JSON.parse(body) as Record<string, unknown>)
    .filter((body) => body.op === 'react');
}

function renderThread(ids: string[], rows: ChatReactionSummaryItem[], token = 0) {
  fetchMock.mockImplementation((input) => {
    if (urlOf(input).includes('op=reactions')) return json({ reactions: rows });
    return json({}, 404);
  });
  const ui = (value: number) => (
    <ReactionsProvider conversationId={CONVERSATION} refreshToken={value}>
      <Thread ids={ids} />
    </ReactionsProvider>
  );
  const view = render(ui(token));
  return { ...view, again: (value: number) => view.rerender(ui(value)) };
}

describe('reactions', () => {
  it('reads the whole thread once, however many messages are on screen', async () => {
    renderThread(
      [MESSAGE_A, MESSAGE_B, MESSAGE_C],
      [row(MESSAGE_A, '👍', 2, false), row(MESSAGE_C, '🙏', 1, true)],
    );
    await screen.findByRole('button', { name: 'Like: 2' });
    expect(reactionReads()).toBe(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/support?op=reactions&id=${CONVERSATION}`);
    // Counts sit under their own message, and the caller's own is marked.
    const third = screen.getByTestId(`row-${MESSAGE_C}`);
    expect(third.querySelector('[aria-pressed="true"][aria-label^="Thanks: 1"]')).toBeTruthy();
  });

  it('shows the eight supported reactions in the bar', async () => {
    renderThread([MESSAGE_A], []);
    const bar = screen.getByRole('toolbar', { name: 'React to this message' });
    expect(
      [...bar.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Love', 'Laugh', 'Wow', 'Sad', 'Angry', 'Like', 'Dislike', 'Thanks']);
    await waitFor(() => expect(reactionReads()).toBe(1));
  });

  it('adds a reaction to the right message and shows the API answer', async () => {
    const view = renderThread([MESSAGE_A, MESSAGE_B], []);
    await waitFor(() => expect(reactionReads()).toBe(1));
    fetchMock.mockImplementation(() =>
      json({
        messageId: MESSAGE_B,
        emoji: '😂',
        added: true,
        summary: [
          { emoji: '😂', count: 3 },
          { emoji: '👍', count: 1 },
        ],
      }),
    );
    const second = view.getByTestId(`row-${MESSAGE_B}`);
    fireEvent.click(second.querySelector('button[aria-label="Laugh"]') as HTMLElement);

    // Counts come from the answer (3, not the optimistic 1), under the second message only.
    expect(await screen.findByRole('button', { name: 'Laugh: 3, your reaction' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Like: 1' })).toBeTruthy();
    expect(view.getByTestId(`row-${MESSAGE_A}`).querySelector('[aria-pressed="true"]')).toBeNull();
    const [posted] = reactionPosts();
    expect(posted).toEqual({
      op: 'react',
      conversationId: CONVERSATION,
      messageId: MESSAGE_B,
      emoji: '😂',
    });
  });

  it('removes the own reaction when the same one is tapped again', async () => {
    const view = renderThread([MESSAGE_A], [row(MESSAGE_A, '👍', 1, true)]);
    await view.findByRole('button', { name: 'Like: 1, your reaction' });
    fetchMock.mockImplementation(() =>
      json({ messageId: MESSAGE_A, emoji: '👍', added: false, summary: [] }),
    );
    fireEvent.click(
      view
        .getByTestId(`row-${MESSAGE_A}`)
        .querySelector('button[aria-label="Like"]') as HTMLElement,
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: /Like: / })).toBeNull());
    expect(reactionPosts()).toHaveLength(1);
  });

  it('changes the reaction when another one is tapped', async () => {
    const view = renderThread([MESSAGE_A], [row(MESSAGE_A, '👍', 1, true)]);
    await view.findByRole('button', { name: 'Like: 1, your reaction' });
    fetchMock.mockImplementation(() =>
      json({
        messageId: MESSAGE_A,
        emoji: '❤️',
        added: true,
        summary: [{ emoji: '❤️', count: 1 }],
      }),
    );
    fireEvent.click(
      view
        .getByTestId(`row-${MESSAGE_A}`)
        .querySelector('button[aria-label="Love"]') as HTMLElement,
    );
    expect(await screen.findByRole('button', { name: 'Love: 1, your reaction' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Like: / })).toBeNull();
  });

  it('refuses a second press while one is in flight, and disables the bar meanwhile', async () => {
    const view = renderThread([MESSAGE_A], []);
    await waitFor(() => expect(reactionReads()).toBe(1));
    let answer!: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const love = view.getByRole('button', { name: 'Love' });
    fireEvent.click(love);
    fireEvent.click(love);
    fireEvent.click(view.getByRole('button', { name: 'Laugh' }));

    expect(reactionPosts()).toHaveLength(1);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Laugh' }).disabled).toBe(true);
    await act(async () => {
      answer(
        await json({
          messageId: MESSAGE_A,
          emoji: '❤️',
          added: true,
          summary: [{ emoji: '❤️', count: 1 }],
        }),
      );
    });
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Laugh' }).disabled).toBe(false),
    );
  });

  it('puts the row back and says why when the API refuses', async () => {
    const view = renderThread([MESSAGE_A], [row(MESSAGE_A, '👍', 1, true)]);
    await view.findByRole('button', { name: 'Like: 1, your reaction' });
    fetchMock.mockImplementation(() =>
      json({ error: { code: 'forbidden', message: 'This account cannot do that.' } }, 403),
    );
    fireEvent.click(
      view.getByTestId(`row-${MESSAGE_A}`).querySelector('button[aria-label="Wow"]') as HTMLElement,
    );

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Your reaction was not saved. This account cannot do that.',
    );
    // Exactly what it showed before the press.
    expect(screen.getByRole('button', { name: 'Like: 1, your reaction' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Wow: / })).toBeNull();
  });

  it('reads the thread again when a realtime update bumps the token', async () => {
    const view = renderThread([MESSAGE_A], [row(MESSAGE_A, '👍', 1, false)]);
    await view.findByRole('button', { name: 'Like: 1' });
    fetchMock.mockImplementation(() => json({ reactions: [row(MESSAGE_A, '👍', 2, false)] }));
    view.again(1);
    expect(await screen.findByRole('button', { name: 'Like: 2' })).toBeTruthy();
    expect(reactionReads()).toBe(2);
  });

  it('applies a toggle to the rows of one message only', () => {
    const rows = [row(MESSAGE_A, '👍', 2, true), row(MESSAGE_A, '🙏', 1, false)];
    expect(applyToggle(rows, MESSAGE_A, '👍')).toEqual([
      row(MESSAGE_A, '👍', 1, false),
      row(MESSAGE_A, '🙏', 1, false),
    ]);
    expect(applyToggle(rows, MESSAGE_A, '🙏')).toEqual([
      row(MESSAGE_A, '👍', 1, false),
      row(MESSAGE_A, '🙏', 2, true),
    ]);
    expect(applyToggle([], MESSAGE_B, '😮')).toEqual([row(MESSAGE_B, '😮', 1, true)]);
    expect(
      rowsFromResponse({
        messageId: MESSAGE_A,
        emoji: '👍',
        added: false,
        summary: [{ emoji: '👍', count: 1 }],
      }),
    ).toEqual([row(MESSAGE_A, '👍', 1, false)]);
  });
});

describe('touch targets of the rating stars and the ask button', () => {
  it('makes each star a 44px square that stays on one row', () => {
    render(<CsatPrompt conversationId="c1" rating={null} />);
    const stars = [1, 2, 3, 4, 5].map((n) =>
      screen.getByRole('button', { name: `${String(n)} out of 5` }),
    );
    for (const star of stars) {
      expect(star.className).toContain('size-11');
      expect(star.className).toContain('shrink-0');
      expect(star.className).toContain('pointer-coarse:size-11');
    }
    // 5 x 44px + gaps fits a 320px screen without wrapping.
    expect(stars[0]?.parentElement?.className).not.toContain('flex-wrap');
  });

  it('gives "Ask about this product" a 44px minimum height on phones and touch screens', () => {
    render(<AskSupportButton label="Ask about this product" request={{ subject: 'Lamp' }} />);
    const button = screen.getByRole('button', { name: 'Ask about this product' });
    expect(button.className).toContain('min-h-11');
    expect(button.className).toContain('pointer-coarse:min-h-11');
  });
});
