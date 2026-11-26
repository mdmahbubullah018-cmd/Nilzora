import * as Clipboard from 'expo-clipboard';
import { Alert, Dimensions, View } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { CHAT_REACTIONS } from '@nilzora/contracts';
import { SupportConversationScreen } from '@/features/support/conversation-screen';
import { MessageActionOverlay } from '@/features/support/message-actions';
import { ReactionCounts } from '@/features/support/support-extras';
import {
  ATTACHMENT_ID,
  CONVERSATION_ID,
  attachment,
  customerMessage,
  reaction,
  storedMessage,
  supportApi,
} from '../test-utils/support-fixtures';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { styleOf } from '../test-utils/style-of';
import { FakeUploadTask } from '../test-utils/upload-fakes';

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock(
  'expo-image-picker',
  () =>
    jest.requireActual<{ expoImagePickerMock: object }>('@/test-utils/upload-fakes')
      .expoImagePickerMock,
);
jest.mock(
  'expo-file-system',
  () =>
    jest.requireActual<{ expoFileSystemMock: object }>('@/test-utils/upload-fakes')
      .expoFileSystemMock,
);
jest.mock(
  'expo-document-picker',
  () =>
    jest.requireActual<{ expoDocumentPickerMock: object }>('@/test-utils/document-picker-fake')
      .expoDocumentPickerMock,
);
jest.mock(
  'expo-audio',
  () =>
    jest.requireActual<{ expoAudioMock: object }>('@/test-utils/audio-recorder-fake').expoAudioMock,
);
jest.mock('socket.io-client', () => ({
  io: () => ({
    connected: false,
    on: () => undefined,
    off: () => undefined,
    emit: () => undefined,
    disconnect: () => undefined,
    removeAllListeners: () => undefined,
  }),
}));

/*
 * The long-press menu: a reaction bar and an action list beside the pressed message. These are
 * jest-level checks of behaviour and wiring; the real positions on a phone are not measured here
 * (the layout maths is covered in support-message-model.test.ts, the placement on a device is not
 * verified by any test).
 */

type MeasureFn = (callback: (x: number, y: number, w: number, h: number) => void) => void;
const proto = (View as unknown as { prototype: { measureInWindow?: MeasureFn } }).prototype;
let originalMeasure: MeasureFn | undefined;

beforeAll(() => {
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.nilzora.test';
  originalMeasure = proto.measureInWindow;
  // Every bubble sits at the same place in the test window.
  proto.measureInWindow = (callback) => callback(40, 300, 200, 60);
});

afterAll(() => {
  if (originalMeasure !== undefined) proto.measureInWindow = originalMeasure;
});

beforeEach(() => {
  FakeUploadTask.reset();
  jest.mocked(Clipboard.setStringAsync).mockClear();
});

const TEXT = storedMessage(1, { body: 'Your parcel ships today' });
const MINE = customerMessage(2, { body: 'Thank you!' });

type User = Awaited<ReturnType<typeof renderWithProviders>>['user'];
let touch!: User;

async function open(api = supportApi({ messages: [TEXT, MINE] })) {
  const view = await renderWithProviders(
    <SupportConversationScreen conversationId={CONVERSATION_ID} />,
    { api },
  );
  touch = view.user;
  return { ...view, api };
}

/**
 * A real press-and-hold: the touch goes to the innermost control under the finger and only to
 * that one, exactly as on a phone. A nested control without its own long-press handler would
 * swallow it and the menu would never open, so these tests catch that.
 */
async function holdOn(element: Parameters<User['longPress']>[0]) {
  await touch.longPress(element);
}

async function longPress(testID: string) {
  await holdOn(await screen.findByTestId(testID));
}

describe('opening the menu', () => {
  it('shows the eight reactions and Reply, Copy and Report for a support message', async () => {
    await open();

    await longPress(`message-${TEXT.id}`);

    const bar = await screen.findByTestId('reaction-bar');
    for (const item of CHAT_REACTIONS) {
      expect(within(bar).getByRole('button', { name: item.label })).toBeOnTheScreen();
    }
    const actions = screen.getByTestId('message-actions');
    expect(within(actions).getByRole('menuitem', { name: 'Reply' })).toBeOnTheScreen();
    expect(within(actions).getByRole('menuitem', { name: 'Copy' })).toBeOnTheScreen();
    expect(within(actions).getByRole('menuitem', { name: 'Report' })).toBeOnTheScreen();
  });

  it('offers no Report for the customer’s own message', async () => {
    await open();

    await longPress(`message-${MINE.id}`);

    const actions = await screen.findByTestId('message-actions');
    expect(within(actions).getByRole('menuitem', { name: 'Copy' })).toBeOnTheScreen();
    expect(within(actions).queryByRole('menuitem', { name: 'Report' })).not.toBeOnTheScreen();
  });

  it('opens for an automated assistant reply, which can be reacted to and reported', async () => {
    const assistant = storedMessage(3, {
      kind: 'automated',
      senderRole: 'system',
      senderId: null,
      senderName: null,
      body: 'Orders ship within two days.',
    });
    await open(supportApi({ messages: [assistant] }));

    await longPress(`message-${assistant.id}`);

    expect(await screen.findByTestId('reaction-bar')).toBeOnTheScreen();
    expect(screen.getByRole('menuitem', { name: 'Report' })).toBeOnTheScreen();
    expect(screen.getByText('Nilzora Assistant')).toBeOnTheScreen();
  });

  it('opens for a file message with Open file and no Copy for the synthetic file-name body', async () => {
    const file = storedMessage(4, {
      body: 'invoice.pdf',
      attachments: [
        attachment({ fileName: 'invoice.pdf', contentType: 'application/pdf', thumbnailUrl: null }),
      ],
    });
    await open(supportApi({ messages: [file] }));

    await longPress(`message-${file.id}`);

    const actions = await screen.findByTestId('message-actions');
    expect(within(actions).getByRole('menuitem', { name: 'Open file' })).toBeOnTheScreen();
    expect(within(actions).queryByRole('menuitem', { name: 'Copy' })).not.toBeOnTheScreen();
    expect(screen.getByTestId('reaction-bar')).toBeOnTheScreen();
  });

  it('opens only for the pressed message', async () => {
    const { api } = await open();

    await longPress(`message-${MINE.id}`);
    api.toggleChatMessageReaction.mockResolvedValue({
      messageId: MINE.id,
      emoji: '👍',
      added: true,
      summary: [],
    });
    await fireEvent.press(await screen.findByRole('button', { name: 'Like' }));

    await waitFor(() =>
      expect(api.toggleChatMessageReaction).toHaveBeenCalledWith(
        expect.anything(),
        CONVERSATION_ID,
        MINE.id,
        '👍',
      ),
    );
  });

  it('does not open for system lines or order events', async () => {
    const system = storedMessage(5, {
      kind: 'system',
      senderRole: 'system',
      body: 'Ticket opened',
    });
    const event = storedMessage(6, {
      kind: 'order_event',
      senderRole: 'system',
      body: 'Order shipped',
    });
    await open(supportApi({ messages: [system, event] }));

    expect(await screen.findByText('Ticket opened')).toBeOnTheScreen();
    await longPress(`message-${event.id}`);

    expect(screen.queryByTestId('reaction-bar')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('message-actions')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('reaction-counts')).not.toBeOnTheScreen();
  });

  it('closes on a tap outside and on the back button', async () => {
    await open();

    await longPress(`message-${TEXT.id}`);
    await fireEvent.press(await screen.findByTestId('message-menu-backdrop'));
    await waitFor(() => expect(screen.queryByTestId('reaction-bar')).not.toBeOnTheScreen());

    await longPress(`message-${TEXT.id}`);
    await screen.findByTestId('reaction-bar');
    await act(async () => {
      await fireEvent(screen.getByTestId('message-menu'), 'requestClose');
    });
    await waitFor(() => expect(screen.queryByTestId('reaction-bar')).not.toBeOnTheScreen());
  });
});

describe('long press on media bubbles', () => {
  const picture = storedMessage(7, {
    body: 'parcel.webp',
    attachments: [attachment()],
  });

  beforeEach(() => {
    // A picture is fetched with the account's token before it is drawn.
  });

  async function openWithPicture(): Promise<void> {
    const api = supportApi({ messages: [picture] });
    api.chatAttachmentMedia.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      fileName: 'parcel.webp',
      contentType: 'image/webp',
    });
    await open(api);
  }

  it('opens from the picture itself, which handles the long press on its own', async () => {
    await openWithPicture();
    const button = await screen.findByLabelText('parcel.webp, open the picture');

    // The picture is a nested control with a tap of its own: holding it must still open the menu.
    await holdOn(button);
    expect(await screen.findByTestId('reaction-bar')).toBeOnTheScreen();
    expect(screen.getByRole('menuitem', { name: 'View picture' })).toBeOnTheScreen();
    // The file name stored as the body is not the customer's text.
    expect(screen.queryByRole('menuitem', { name: 'Copy' })).not.toBeOnTheScreen();
  });

  it('opens from a file card and from a voice message the same way', async () => {
    const doc = storedMessage(8, {
      body: 'sheet.xlsx',
      attachments: [
        attachment({
          id: '00000000-0000-4000-8000-0000000000a2',
          fileName: 'sheet.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          thumbnailUrl: null,
        }),
      ],
    });
    await open(supportApi({ messages: [doc] }));
    const card = await screen.findByLabelText('Open sheet.xlsx');

    await holdOn(card);

    expect(await screen.findByTestId('reaction-bar')).toBeOnTheScreen();
    expect(screen.getByRole('menuitem', { name: 'Open file' })).toBeOnTheScreen();
  });

  it('opens from the voice player controls', async () => {
    const voice = storedMessage(9, {
      body: 'voice.m4a',
      attachments: [
        attachment({
          id: '00000000-0000-4000-8000-0000000000a3',
          fileName: 'voice.m4a',
          contentType: 'audio/mp4',
          durationMs: 4000,
          thumbnailUrl: null,
        }),
      ],
    });
    const api = supportApi({ messages: [voice] });
    api.chatAttachmentMedia.mockResolvedValue({
      bytes: new Uint8Array([1]),
      fileName: 'voice.m4a',
      contentType: 'audio/mp4',
    });
    await open(api);
    const play = await screen.findByRole('button', { name: 'Play the voice message' });

    await holdOn(play);

    expect(await screen.findByTestId('reaction-bar')).toBeOnTheScreen();
    expect(screen.getByRole('menuitem', { name: 'Open voice message' })).toBeOnTheScreen();
  });

  it('opens the stored picture in the viewer from View picture', async () => {
    await openWithPicture();
    await holdOn(await screen.findByLabelText('parcel.webp, open the picture'));

    await fireEvent.press(await screen.findByRole('menuitem', { name: 'View picture' }));

    await waitFor(() => expect(screen.queryByTestId('reaction-bar')).not.toBeOnTheScreen());
    expect(ATTACHMENT_ID).toBeTruthy();
  });
});

describe('reacting', () => {
  function toggled(emoji: string, added = true) {
    return { messageId: TEXT.id, emoji, added, summary: [] };
  }

  it('adds a reaction with one tap and closes the menu', async () => {
    const { api } = await open();
    api.toggleChatMessageReaction.mockResolvedValue(toggled('❤️'));
    await longPress(`message-${TEXT.id}`);

    await fireEvent.press(await screen.findByRole('button', { name: 'Love' }));

    await waitFor(() =>
      expect(api.toggleChatMessageReaction).toHaveBeenCalledWith(
        expect.anything(),
        CONVERSATION_ID,
        TEXT.id,
        '❤️',
      ),
    );
    await waitFor(() => expect(screen.queryByTestId('reaction-bar')).not.toBeOnTheScreen());
  });

  it('highlights the customer’s own reaction, removes it on the same tap and changes it on another', async () => {
    const api = supportApi({ messages: [TEXT] });
    api.listChatReactionSummary.mockResolvedValue({
      reactions: [reaction(TEXT.id, '👍', { mine: true, count: 2 })],
    });
    api.toggleChatMessageReaction.mockResolvedValue(toggled('👍', false));
    await open(api);
    await screen.findByLabelText('Like: 2');

    await longPress(`message-${TEXT.id}`);
    const own = await screen.findByRole('button', { name: 'Like, remove' });
    expect(own.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));

    // The same emoji again is a removal (the server toggles it off).
    await fireEvent.press(own);
    await waitFor(() => expect(api.toggleChatMessageReaction).toHaveBeenCalledTimes(1));
    expect(api.toggleChatMessageReaction).toHaveBeenLastCalledWith(
      expect.anything(),
      CONVERSATION_ID,
      TEXT.id,
      '👍',
    );

    // Another emoji replaces it.
    api.toggleChatMessageReaction.mockResolvedValue(toggled('😂'));
    await longPress(`message-${TEXT.id}`);
    await fireEvent.press(await screen.findByRole('button', { name: 'Laugh' }));
    await waitFor(() => expect(api.toggleChatMessageReaction).toHaveBeenCalledTimes(2));
    expect(api.toggleChatMessageReaction).toHaveBeenLastCalledWith(
      expect.anything(),
      CONVERSATION_ID,
      TEXT.id,
      '😂',
    );
  });

  it('ignores a second tap while the first reaction is still being saved', async () => {
    const { api } = await open();
    let finish!: (value: ReturnType<typeof toggled>) => void;
    api.toggleChatMessageReaction.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await longPress(`message-${TEXT.id}`);

    const love = await screen.findByRole('button', { name: 'Love' });
    await fireEvent.press(love);
    await fireEvent.press(love);
    await fireEvent.press(screen.getByRole('button', { name: 'Wow' }));

    expect(api.toggleChatMessageReaction).toHaveBeenCalledTimes(1);
    await act(() => {
      finish(toggled('❤️'));
    });
  });

  it('shows a refusal inside the menu, keeps it open and allows another try', async () => {
    const { api } = await open();
    api.toggleChatMessageReaction.mockRejectedValueOnce(new Error('offline'));
    await longPress(`message-${TEXT.id}`);

    await fireEvent.press(await screen.findByRole('button', { name: 'Love' }));

    expect(await screen.findByRole('alert')).toBeOnTheScreen();
    expect(screen.getByTestId('reaction-bar')).toBeOnTheScreen();
    expect(screen.getByTestId('chat-toast')).toBeOnTheScreen();

    api.toggleChatMessageReaction.mockResolvedValueOnce(toggled('❤️'));
    await fireEvent.press(screen.getByRole('button', { name: 'Love' }));
    await waitFor(() => expect(api.toggleChatMessageReaction).toHaveBeenCalledTimes(2));
  });

  it('keeps a visible counts row under the bubble, including for the assistant and files', async () => {
    const assistant = storedMessage(3, {
      kind: 'automated',
      senderRole: 'system',
      senderId: null,
      senderName: null,
      body: 'Orders ship within two days.',
    });
    const api = supportApi({ messages: [assistant, TEXT] });
    api.listChatReactionSummary.mockResolvedValue({
      reactions: [reaction(assistant.id, '❤️', { count: 3 }), reaction(TEXT.id, '🙏')],
    });
    await open(api);

    expect(await screen.findByLabelText('Love: 3')).toBeOnTheScreen();
    expect(screen.getByLabelText('Thanks: 1')).toBeOnTheScreen();

    api.toggleChatMessageReaction.mockResolvedValue({
      messageId: assistant.id,
      emoji: '❤️',
      added: true,
      summary: [],
    });
    await fireEvent.press(screen.getByLabelText('Love: 3'));
    await waitFor(() =>
      expect(api.toggleChatMessageReaction).toHaveBeenCalledWith(
        expect.anything(),
        CONVERSATION_ID,
        assistant.id,
        '❤️',
      ),
    );
  });
});

describe('the other actions', () => {
  it('copies the text of a message and says so', async () => {
    await open();
    await longPress(`message-${TEXT.id}`);

    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Copy' }));

    await waitFor(() =>
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith('Your parcel ships today'),
    );
    expect(await screen.findByText('Copied')).toBeOnTheScreen();
    expect(screen.queryByTestId('reaction-bar')).not.toBeOnTheScreen();
  });

  it('answers a message from the menu', async () => {
    await open();
    await longPress(`message-${TEXT.id}`);

    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Reply' }));

    expect(await screen.findByText('Answering Rumana')).toBeOnTheScreen();
    expect(screen.queryByTestId('reaction-bar')).not.toBeOnTheScreen();
  });

  it('keeps the reasons flow for Report', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { api } = await open();
    api.reportChatMessage.mockResolvedValue({
      id: '00000000-0000-4000-8000-0000000000e1',
      messageId: TEXT.id,
      status: 'open',
    });
    await longPress(`message-${TEXT.id}`);

    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Report' }));

    expect(alert).toHaveBeenCalledWith(
      'Report this message',
      expect.any(String),
      expect.arrayContaining([expect.objectContaining({ text: 'Spam' })]),
    );
    alert.mockRestore();
  });
});

describe('reaction touch targets', () => {
  const original = Dimensions.get('window');
  afterEach(async () => {
    await act(() => {
      Dimensions.set({ window: original });
    });
  });

  async function overlay(width: number, height: number, failure: string | null = null) {
    await act(() => {
      Dimensions.set({ window: { ...original, width, height } });
    });
    return render(
      <MessageActionOverlay
        target={{
          message: TEXT,
          anchor: { x: 40, y: Math.floor(height / 2), width: 200, height: 60 },
          mine: false,
        }}
        myEmoji="👍"
        reacting={false}
        failure={failure}
        onReact={jest.fn()}
        onReply={jest.fn()}
        onCopy={jest.fn()}
        onReport={jest.fn()}
        onViewPicture={jest.fn()}
        onOpenFile={jest.fn()}
        onClose={jest.fn()}
      />,
    );
  }

  it.each([
    [320, 4, 2],
    [360, 4, 2],
    [390, 8, 1],
    [412, 8, 1],
    [600, 8, 1],
  ])(
    'draws 44 dp reactions on a %i dp wide screen in %i columns x %i rows',
    async (w, cols, rows) => {
      await overlay(w, 800);
      const bar = styleOf(await screen.findByTestId('reaction-bar'));
      const barLeft = Number(bar.left);
      const barWidth = Number(bar.width);
      expect(bar.width).toBe(cols * 44 + 8);
      expect(bar.height).toBe(rows * 44 + 8);
      // The bar is positioned inside the window and wraps rather than clipping.
      expect(bar.flexWrap).toBe('wrap');
      expect(barLeft).toBeGreaterThanOrEqual(12);
      expect(barLeft + barWidth).toBeLessThanOrEqual(w - 12);
      const buttons = within(screen.getByTestId('reaction-bar')).getAllByRole('button');
      expect(buttons).toHaveLength(8);
      for (const button of buttons) {
        const style = styleOf(button);
        expect(style.width).toBe(44);
        expect(style.height).toBe(44);
      }
    },
  );

  it('keeps the labels, roles and selected state on the reactions and the rows', async () => {
    await overlay(360, 800);
    const like = screen.getByRole('button', { name: 'Like, remove' });
    expect(like.props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole('button', { name: 'Love' }).props.accessibilityState).toMatchObject({
      selected: false,
    });
    const toolbar = screen.getByTestId('reaction-bar');
    expect(toolbar.props.accessibilityRole).toBe('toolbar');
    expect(toolbar.props.accessibilityLabel).toBe('Reactions');
    for (const row of screen.getAllByRole('menuitem')) {
      const style = styleOf(row);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  it('never lets the bar and the list overlap, even on a very short screen', async () => {
    await overlay(360, 300, 'Your reaction was not saved. Try again.');
    const bar = styleOf(screen.getByTestId('reaction-bar'));
    const list = styleOf(screen.getByTestId('message-actions'));
    const barTop = Number(bar.top);
    const listTop = Number(list.top);
    expect(barTop).toBeGreaterThanOrEqual(0);
    const barBottom = barTop + Number(bar.height);
    const listBottom = listTop + Number(list.maxHeight);
    expect(listTop >= barBottom || barTop >= listBottom).toBe(true);
    // Inside the window, with the list shortened to what is left.
    expect(listBottom).toBeLessThanOrEqual(300);
    expect(Number(list.maxHeight)).toBeGreaterThan(0);
  });

  it('gives the count chips under a bubble a full 44 dp target and keeps their state', async () => {
    const onToggle = jest.fn();
    await render(
      <ReactionCounts
        message={TEXT}
        summary={[reaction(TEXT.id, '👍', { mine: true, count: 2 }), reaction(TEXT.id, '❤️')]}
        mine={false}
        disabled={false}
        onToggle={onToggle}
      />,
    );
    const chip = screen.getByRole('button', { name: 'Like: 2' });
    const style = styleOf(chip);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(chip.props.accessibilityState).toMatchObject({ selected: true });
    await fireEvent.press(chip);
    expect(onToggle).toHaveBeenCalledWith(TEXT, '👍');
  });
});
