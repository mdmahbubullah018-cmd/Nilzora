import type { ChatConversationDetail } from '@nilzora/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { SupportConversationScreen } from '@/features/support/conversation-screen';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { styleOf } from '../test-utils/style-of';
import { FakeDocumentPicker } from '../test-utils/document-picker-fake';
import { renderWithProviders } from '../test-utils/render-with-providers';
import {
  choose,
  fakeAsset,
  deletedFiles,
  FakeUploadTask,
  inAct,
  lastTask,
  permissions,
} from '../test-utils/upload-fakes';
import { FakeAudioRecorder } from '../test-utils/audio-recorder-fake';

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
// The live socket is an optimisation over REST; a test needs the screen, not a connection.
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

const CONVERSATION_ID = '00000000-0000-4000-8000-0000000000c1';
const ATTACHMENT_ID = '00000000-0000-4000-8000-0000000000a1';

/** A conversation as the API answers it for the customer who owns it. */
function conversation(
  overrides: Partial<ChatConversationDetail['conversation']> = {},
  participants: ChatConversationDetail['participants'] = [],
): ChatConversationDetail {
  return {
    conversation: {
      id: CONVERSATION_ID,
      kind: 'customer_support',
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
      messageCount: 0,
      createdAt: '2026-11-05T09:00:00.000Z',
      updatedAt: '2026-11-05T10:00:00.000Z',
      resolvedAt: null,
      closedAt: null,
      csatRating: null,
      ...overrides,
    },
    viewer: {
      userId: '00000000-0000-4000-8000-0000000000b1',
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
    participants,
  };
}

/** The API's answer to a successful attachment upload. */
function uploadedAttachment() {
  return {
    id: ATTACHMENT_ID,
    conversationId: CONVERSATION_ID,
    objectKey: 'chat/attachments/one',
    fileName: 'receipt.webp',
    contentType: 'image/webp',
    byteSize: 4096,
    width: 800,
    height: 600,
    durationMs: null,
    status: 'pending' as const,
  };
}

function supportApi() {
  const api = createFakeApiClient();
  api.getChatConversation.mockResolvedValue(conversation());
  api.listChatMessages.mockResolvedValue({ messages: [], nextCursor: null });
  api.listChatPinnedMessages.mockResolvedValue({ messages: [] });
  api.listChatReactionSummary.mockResolvedValue({ reactions: [] });
  api.markChatRead.mockResolvedValue({ unread: 0 });
  api.postChatMessage.mockResolvedValue({
    message: {
      id: '00000000-0000-4000-8000-0000000000d1',
      seq: 1,
      senderId: '00000000-0000-4000-8000-0000000000b1',
      senderRole: 'customer',
      senderName: 'Customer',
      kind: 'text',
      body: null,
      replyToId: null,
      metadata: {},
      createdAt: '2026-11-05T10:01:00.000Z',
    },
    duplicate: false,
    unreadCount: 0,
    attachments: [],
  });
  api.sendChatMessage.mockResolvedValue({
    message: storedMessage(1, 'Hello'),
    duplicate: false,
    unread: 0,
  });
  return api;
}

/** A message as the read contract carries it (attachments and edit state included). */
function storedMessage(seq: number, body: string | null) {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    seq,
    senderId: '00000000-0000-4000-8000-0000000000b1',
    senderRole: 'customer' as const,
    senderName: 'Customer',
    kind: 'text' as const,
    body,
    replyToId: null,
    metadata: {},
    editedAt: null,
    createdAt: '2026-11-05T10:01:00.000Z',
    attachments: [],
  };
}

type User = Awaited<ReturnType<typeof renderWithProviders>>['user'];

/** The one attach button, then one of the three real options in its sheet. */
async function attach(user: User, option: 'Photo library' | 'Camera' | 'Files') {
  await user.press(await screen.findByRole('button', { name: 'Attach' }));
  await user.press(await screen.findByRole('button', { name: option }));
}

beforeAll(() => {
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.nilzora.test';
});

beforeEach(() => {
  FakeUploadTask.reset();
  FakeDocumentPicker.reset();
  FakeAudioRecorder.reset();
  permissions(true);
});

describe('the support conversation screen', () => {
  it('pins the product and order the thread is about above the messages', async () => {
    const api = supportApi();
    api.getChatConversation.mockResolvedValue({
      ...conversation(),
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
            image: null,
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
    });

    await renderWithProviders(<SupportConversationScreen conversationId={CONVERSATION_ID} />, {
      api,
    });

    expect(
      await screen.findByLabelText('About Cotton panjabi, Size: M · Order NZ100042'),
    ).toBeOnTheScreen();
  });

  it('shows no context row when the thread is about nothing in particular', async () => {
    await renderWithProviders(<SupportConversationScreen conversationId={CONVERSATION_ID} />, {
      api: supportApi(),
    });

    expect(await screen.findByRole('header', { name: 'Where is my order?' })).toBeOnTheScreen();
    expect(screen.queryByLabelText(/^About /)).not.toBeOnTheScreen();
  });

  it('offers one attach button and the microphone, not a row of separate icons', async () => {
    const { user } = await renderWithProviders(
      <SupportConversationScreen conversationId={CONVERSATION_ID} />,
      { api: supportApi() },
    );

    expect(await screen.findByRole('header', { name: 'Where is my order?' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Attach' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Record a voice message' })).toBeOnTheScreen();
    // The old separate icons are gone.
    expect(screen.queryByRole('button', { name: 'Send a photo' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Take a photo' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'More attachment options' })).not.toBeOnTheScreen();

    // The sheet offers exactly the three real sources.
    await user.press(screen.getByRole('button', { name: 'Attach' }));
    expect(await screen.findByRole('button', { name: 'Photo library' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Camera' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Files' })).toBeOnTheScreen();
  });

  it('keeps a chosen picture local until Send, then uploads it and posts the message', async () => {
    choose(fakeAsset({ fileName: 'receipt.png', mimeType: 'image/png', fileSize: 4096 }));
    const api = supportApi();
    const { user } = await renderWithProviders(
      <SupportConversationScreen conversationId={CONVERSATION_ID} />,
      { api },
    );

    await attach(user, 'Photo library');

    // Choosing is not sending: the row says what is waiting, and nothing has left the phone.
    expect(await screen.findByText('1 of 5 ready to send')).toBeOnTheScreen();
    expect(FakeUploadTask.all).toHaveLength(0);
    expect(api.postChatMessage).not.toHaveBeenCalled();

    await user.press(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(FakeUploadTask.all).toHaveLength(1));
    expect(lastTask().url).toContain(`/chat/conversations/${CONVERSATION_ID}/attachments`);

    lastTask().answer(201, uploadedAttachment());

    await waitFor(() =>
      expect(api.postChatMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          conversationId: CONVERSATION_ID,
          attachmentIds: [ATTACHMENT_ID],
        }),
      ),
    );
    // Sent is sent: the row is empty again.
    await waitFor(() => expect(screen.queryByText('1 of 5 ready to send')).not.toBeOnTheScreen());
  });

  it('drops one chosen file, and empties the row, without touching the network', async () => {
    choose(
      fakeAsset({ fileName: 'first.png', mimeType: 'image/png', fileSize: 2048 }),
      fakeAsset({ fileName: 'second.png', mimeType: 'image/png', fileSize: 2048 }),
    );
    const api = supportApi();
    const { user } = await renderWithProviders(
      <SupportConversationScreen conversationId={CONVERSATION_ID} />,
      { api },
    );

    // Two pictures in one library visit land in the row together, with no preview step.
    await attach(user, 'Photo library');
    await waitFor(() => expect(screen.getByText('2 of 5 ready to send')).toBeOnTheScreen());
    expect(screen.queryByTestId('photo-preview')).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Remove first.png' }));
    await waitFor(() => expect(screen.getByText('1 of 5 ready to send')).toBeOnTheScreen());

    await user.press(screen.getByRole('button', { name: 'Clear all selected files' }));

    await waitFor(() => expect(screen.queryByText('1 of 5 ready to send')).not.toBeOnTheScreen());
    expect(FakeUploadTask.all).toHaveLength(0);
    expect(api.discardChatAttachment).not.toHaveBeenCalled();
  });

  it('sends every chosen file as one message, with all of their ids', async () => {
    choose(
      fakeAsset({ fileName: 'one.png', mimeType: 'image/png', fileSize: 2048 }),
      fakeAsset({ fileName: 'two.png', mimeType: 'image/png', fileSize: 2048 }),
    );
    const api = supportApi();
    const { user } = await renderWithProviders(
      <SupportConversationScreen conversationId={CONVERSATION_ID} />,
      { api },
    );

    await attach(user, 'Photo library');
    await waitFor(() => expect(screen.getByText('2 of 5 ready to send')).toBeOnTheScreen());

    await user.type(screen.getByLabelText('Message'), 'Both of these, please');
    await user.press(screen.getByRole('button', { name: 'Send message' }));

    // One upload per file, then a single message carrying both ids.
    await waitFor(() => expect(FakeUploadTask.all).toHaveLength(1));
    lastTask().answer(201, { ...uploadedAttachment(), id: ATTACHMENT_ID });
    await waitFor(() => expect(FakeUploadTask.all).toHaveLength(2));
    lastTask().answer(201, {
      ...uploadedAttachment(),
      id: '00000000-0000-4000-8000-0000000000a2',
    });

    await waitFor(() =>
      expect(api.postChatMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          attachmentIds: [ATTACHMENT_ID, '00000000-0000-4000-8000-0000000000a2'],
          body: 'Both of these, please',
        }),
      ),
    );
  });

  it('keeps the draft and the chosen files when an upload fails', async () => {
    choose(fakeAsset({ fileName: 'broken.png', mimeType: 'image/png', fileSize: 2048 }));
    const api = supportApi();
    const { user } = await renderWithProviders(
      <SupportConversationScreen conversationId={CONVERSATION_ID} />,
      { api },
    );

    await attach(user, 'Photo library');
    await waitFor(() => expect(screen.getByText('1 of 5 ready to send')).toBeOnTheScreen());
    await user.type(screen.getByLabelText('Message'), 'Please send it again');
    await user.press(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(FakeUploadTask.all).toHaveLength(1));
    lastTask().fail();

    expect(await screen.findByText(/connection was lost/)).toBeOnTheScreen();
    // Nothing was posted, and the customer still has their words and their file.
    expect(api.postChatMessage).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Message')).toHaveDisplayValue('Please send it again');
    expect(screen.getByText('1 of 5 ready to send')).toBeOnTheScreen();

    // Send again: a fresh upload, then the message goes with the file's id.
    await user.press(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(FakeUploadTask.all).toHaveLength(2));
    lastTask().answer(201, uploadedAttachment());
    await waitFor(() =>
      expect(api.postChatMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ attachmentIds: [ATTACHMENT_ID], body: 'Please send it again' }),
      ),
    );
  });

  it('refuses a sixth file instead of uploading it', async () => {
    choose(
      ...[1, 2, 3, 4, 5, 6].map((n) =>
        fakeAsset({ fileName: `shot${String(n)}.png`, mimeType: 'image/png', fileSize: 1024 }),
      ),
    );
    const { user } = await renderWithProviders(
      <SupportConversationScreen conversationId={CONVERSATION_ID} />,
      { api: supportApi() },
    );

    await attach(user, 'Photo library');

    // Five fit; the sixth is refused with a reason rather than being quietly dropped.
    await waitFor(() => expect(screen.getByText('5 of 5 ready to send')).toBeOnTheScreen());
    expect(screen.getByText(/at most 5 files/)).toBeOnTheScreen();
    expect(FakeUploadTask.all).toHaveLength(0);
  });

  it('marks a stored message as sent, and a teammate as handling the thread', async () => {
    const api = createFakeApiClient();
    const assigneeId = '00000000-0000-4000-8000-0000000000ff';
    api.getChatConversation.mockResolvedValue(
      conversation({ assigneeId, status: 'pending' }, [
        {
          userId: '00000000-0000-4000-8000-0000000000b1',
          role: 'customer',
          name: 'Customer One',
          email: null,
          lastReadSeq: 0,
          lastDeliveredSeq: 0,
          joinedAt: '2026-11-05T09:00:00.000Z',
        },
        {
          userId: assigneeId,
          role: 'staff',
          name: 'Rumana',
          email: null,
          lastReadSeq: 0,
          lastDeliveredSeq: 0,
          joinedAt: '2026-11-05T09:30:00.000Z',
        },
      ]),
    );
    api.listChatMessages.mockResolvedValue({
      messages: [storedMessage(3, 'On its way')],
      nextCursor: null,
    });
    api.listChatPinnedMessages.mockResolvedValue({ messages: [] });
    api.listChatReactionSummary.mockResolvedValue({ reactions: [] });
    api.markChatRead.mockResolvedValue({ unread: 0 });

    await renderWithProviders(<SupportConversationScreen conversationId={CONVERSATION_ID} />, {
      api,
    });

    // The customer can tell the thread belongs to a person now, by name.
    expect(await screen.findByText('Rumana is handling this')).toBeOnTheScreen();
    // And the message the store kept is honest about being sent.
    expect(await screen.findByLabelText('Sent')).toBeOnTheScreen();
  });

  it('does nothing but explain when the camera permission is refused', async () => {
    permissions(false);
    const api = supportApi();
    const { user } = await renderWithProviders(
      <SupportConversationScreen conversationId={CONVERSATION_ID} />,
      { api },
    );

    await attach(user, 'Camera');

    expect(await screen.findByText(/permission to use the camera/)).toBeOnTheScreen();
    expect(screen.queryByTestId('photo-preview')).not.toBeOnTheScreen();
    expect(FakeUploadTask.all).toHaveLength(0);
  });

  it('sends a document chosen from the Files option, uploading only on Send', async () => {
    FakeDocumentPicker.next({
      name: 'invoice.pdf',
      mimeType: 'application/pdf',
      size: 2048,
      uri: 'file:///cache/invoice.pdf',
    });
    const api = supportApi();
    const { user } = await renderWithProviders(
      <SupportConversationScreen conversationId={CONVERSATION_ID} />,
      { api },
    );

    await attach(user, 'Files');

    // A document joins the row like a picture, and is uploaded only when Send is pressed.
    await waitFor(() => expect(screen.getByText('1 of 5 ready to send')).toBeOnTheScreen());
    expect(screen.getByText('invoice.pdf')).toBeOnTheScreen();
    expect(FakeUploadTask.all).toHaveLength(0);

    await user.press(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(FakeUploadTask.all).toHaveLength(1));

    lastTask().answer(201, {
      ...uploadedAttachment(),
      fileName: 'invoice.pdf',
      contentType: 'application/pdf',
    });
    await waitFor(() =>
      expect(api.postChatMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ attachmentIds: [ATTACHMENT_ID] }),
      ),
    );
  });

  it('says a received picture could not load, and asks for it again on tap', async () => {
    const api = supportApi();
    api.listChatMessages.mockResolvedValue({
      messages: [
        {
          ...storedMessage(1, null),
          attachments: [
            {
              id: ATTACHMENT_ID,
              fileName: 'parcel.webp',
              contentType: 'image/webp',
              byteSize: 2048,
              width: 800,
              height: 600,
              durationMs: null,
              url: `/chat/attachments/${ATTACHMENT_ID}/media`,
              thumbnailUrl: `/chat/attachments/${ATTACHMENT_ID}/media?variant=thumb`,
            },
          ],
        },
      ],
      nextCursor: null,
    });
    // Private media is fetched with the account's own token; this test is about the failure path.
    api.chatAttachmentMedia.mockRejectedValue(new Error('gone'));
    await renderWithProviders(<SupportConversationScreen conversationId={CONVERSATION_ID} />, {
      api,
    });

    expect(await screen.findByText('Picture didn’t load')).toBeOnTheScreen();
    expect(screen.getAllByText('Tap to try again').length).toBeGreaterThan(0);
  });

  it('fetches a picture with the account token and shows it once it arrives', async () => {
    const api = supportApi();
    api.listChatMessages.mockResolvedValue({
      messages: [
        {
          ...storedMessage(1, null),
          attachments: [
            {
              id: ATTACHMENT_ID,
              fileName: 'parcel.webp',
              contentType: 'image/webp',
              byteSize: 2048,
              width: 800,
              height: 600,
              durationMs: null,
              url: `/chat/attachments/${ATTACHMENT_ID}/media`,
              thumbnailUrl: `/chat/attachments/${ATTACHMENT_ID}/media?variant=thumb`,
            },
          ],
        },
      ],
      nextCursor: null,
    });
    api.chatAttachmentMedia.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      fileName: 'parcel.webp',
      contentType: 'image/webp',
    });
    await renderWithProviders(<SupportConversationScreen conversationId={CONVERSATION_ID} />, {
      api,
    });

    expect(await screen.findByLabelText('parcel.webp')).toBeOnTheScreen();
    // The thumbnail is a variant of the same attachment, requested with the caller's token.
    expect(api.chatAttachmentMedia).toHaveBeenCalledWith(expect.anything(), ATTACHMENT_ID, 'thumb');
  });

  it('opens the recorder for a voice note and never shows call controls', async () => {
    const { user } = await renderWithProviders(
      <SupportConversationScreen conversationId={CONVERSATION_ID} />,
      { api: supportApi() },
    );
    // Nothing is recorded, and the microphone is not even asked for, until the mic is tapped.
    expect(FakeAudioRecorder.permissionRequests).toBe(0);

    await user.press(await screen.findByRole('button', { name: 'Record a voice message' }));

    // The tap starts the recording (and asks for the permission): there is a pause control now.
    expect(await screen.findByRole('button', { name: 'Pause recording' })).toBeOnTheScreen();
    expect(FakeAudioRecorder.permissionRequests).toBe(1);
    expect(screen.queryByRole('button', { name: /call/i })).not.toBeOnTheScreen();
    expect(screen.queryByText(/ringing/i)).not.toBeOnTheScreen();
  });

  it('explains a refused microphone and points at Settings, without recording', async () => {
    FakeAudioRecorder.denyPermission();
    const { user } = await renderWithProviders(
      <SupportConversationScreen conversationId={CONVERSATION_ID} />,
      { api: supportApi() },
    );

    await user.press(await screen.findByRole('button', { name: 'Record a voice message' }));

    expect(await screen.findByText(/permission to use your microphone/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Open settings' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Pause recording' })).not.toBeOnTheScreen();
  });

  it('sends a voice note in one step: Send uploads with its length, then posts', async () => {
    const api = supportApi();
    const { user } = await renderWithProviders(
      <SupportConversationScreen conversationId={CONVERSATION_ID} />,
      { api },
    );

    await user.press(await screen.findByRole('button', { name: 'Record a voice message' }));
    await user.press(await screen.findByRole('button', { name: 'Stop and keep the recording' }));

    expect(await screen.findByTestId('voice-preview')).toBeOnTheScreen();
    // Stopping is not sending: nothing has left the phone yet, and the take can be heard.
    expect(FakeUploadTask.all).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Play the recording' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Discard the recording' })).toBeOnTheScreen();
    expect(screen.getByText('0:04')).toBeOnTheScreen();

    // Every control of the preview is a full 44 dp target, and the row may wrap rather than
    // run past a 320 dp screen; the seek track is a 44 dp row with a thin bar inside it.
    for (const name of ['Play the recording', 'Discard the recording', 'Send the voice message']) {
      const style = styleOf(screen.getByRole('button', { name }));
      expect(style.width).toBeGreaterThanOrEqual(44);
      expect(style.height).toBeGreaterThanOrEqual(44);
    }
    expect(
      styleOf(screen.getByRole('adjustable', { name: 'Position in the recording' })),
    ).toMatchObject({ minHeight: 44, flex: 1 });
    expect(styleOf(screen.getByTestId('voice-preview').children[1] as never).flexWrap).toBe('wrap');

    // One tap on Send: it uploads straight away (no chip, no second Send) ...
    await user.press(screen.getByRole('button', { name: 'Send the voice message' }));
    await waitFor(() => expect(FakeUploadTask.all).toHaveLength(1));
    expect(lastTask().url).toContain(`/chat/conversations/${CONVERSATION_ID}/attachments`);
    expect(lastTask().url).toContain('durationMs=4200');
    expect(screen.queryByText('1 of 5 ready to send')).not.toBeOnTheScreen();
    await inAct(() => lastTask().progress(500, 1000));
    expect(await screen.findByText('Sending 50%')).toBeOnTheScreen();

    // ... and posts the message with the stored file once the upload is answered.
    lastTask().answer(201, {
      ...uploadedAttachment(),
      fileName: 'voice.m4a',
      contentType: 'audio/mp4',
    });
    await waitFor(() =>
      expect(api.postChatMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ attachmentIds: [ATTACHMENT_ID] }),
      ),
    );
    await waitFor(() => expect(screen.queryByTestId('voice-preview')).not.toBeOnTheScreen());
  });

  it('keeps the voice take and offers a retry when its upload fails', async () => {
    const api = supportApi();
    const { user } = await renderWithProviders(
      <SupportConversationScreen conversationId={CONVERSATION_ID} />,
      { api },
    );

    await user.press(await screen.findByRole('button', { name: 'Record a voice message' }));
    await user.press(await screen.findByRole('button', { name: 'Stop and keep the recording' }));
    await user.press(await screen.findByRole('button', { name: 'Send the voice message' }));
    await waitFor(() => expect(FakeUploadTask.all).toHaveLength(1));
    lastTask().fail();

    expect(await screen.findByText(/connection was lost/)).toBeOnTheScreen();
    expect(api.postChatMessage).not.toHaveBeenCalled();
    await user.press(
      await screen.findByRole('button', { name: 'Retry sending the voice message' }),
    );
    await waitFor(() => expect(FakeUploadTask.all).toHaveLength(2));
    lastTask().answer(201, {
      ...uploadedAttachment(),
      fileName: 'voice.m4a',
      contentType: 'audio/mp4',
    });
    await waitFor(() => expect(api.postChatMessage).toHaveBeenCalledTimes(1));
  });

  it('moves the take to where the customer tapped on its track', async () => {
    const { user } = await renderWithProviders(
      <SupportConversationScreen conversationId={CONVERSATION_ID} />,
      { api: supportApi() },
    );

    await user.press(await screen.findByRole('button', { name: 'Record a voice message' }));
    await user.press(await screen.findByRole('button', { name: 'Stop and keep the recording' }));
    await screen.findByTestId('voice-preview');

    const track = screen.getByRole('adjustable', { name: 'Position in the recording' });
    // The track is 200 wide and the take runs 4.2s: a tap at 100 is 2.1s in.
    await act(async () => {
      await fireEvent(track, 'layout', { nativeEvent: { layout: { width: 200 } } });
    });
    await act(async () => {
      await fireEvent.press(track, { nativeEvent: { locationX: 100 } });
    });

    await waitFor(() => expect(FakeAudioRecorder.seeks).toEqual([2.1]));
  });

  it('throws a recording away without uploading it', async () => {
    const { user } = await renderWithProviders(
      <SupportConversationScreen conversationId={CONVERSATION_ID} />,
      { api: supportApi() },
    );

    await user.press(await screen.findByRole('button', { name: 'Record a voice message' }));
    await user.press(await screen.findByRole('button', { name: 'Stop and keep the recording' }));
    await user.press(await screen.findByRole('button', { name: 'Discard the recording' }));

    await waitFor(() => expect(screen.queryByTestId('voice-preview')).not.toBeOnTheScreen());
    expect(FakeUploadTask.all).toHaveLength(0);
    // The temporary file is removed, so a discarded take never leaks storage.
    await waitFor(() => expect(deletedFiles).toContain('file:///cache/voice.m4a'));
  });

  it('shows the message at once, clears the composer, and keeps the stored copy', async () => {
    const api = supportApi();
    type Posted = { message: ReturnType<typeof storedMessage>; duplicate: boolean; unread: number };
    let answer!: (value: Posted) => void;
    api.sendChatMessage.mockImplementation(
      () =>
        new Promise<Posted>((resolve) => {
          answer = resolve;
        }),
    );
    const { user } = await renderWithProviders(
      <SupportConversationScreen conversationId={CONVERSATION_ID} />,
      { api },
    );

    await user.type(await screen.findByLabelText('Message'), 'Where is my parcel?');
    await user.press(screen.getByRole('button', { name: 'Send message' }));

    // Visible before the API has answered, and the composer is already empty.
    expect(screen.getByText('Where is my parcel?')).toBeOnTheScreen();
    expect(screen.getByLabelText('Message')).toHaveDisplayValue('');
    expect(screen.getByText('Sending…')).toBeOnTheScreen();

    answer({ message: storedMessage(1, 'Where is my parcel?'), duplicate: false, unread: 0 });

    await waitFor(() => expect(screen.queryByText('Sending…')).not.toBeOnTheScreen());
    // One bubble, not two: the local row is replaced by the stored one.
    expect(screen.getAllByText('Where is my parcel?')).toHaveLength(1);
  });

  it('keeps an unsent message with a retry that reuses its client id', async () => {
    const api = supportApi();
    api.sendChatMessage.mockRejectedValueOnce(new Error('offline'));
    const { user } = await renderWithProviders(
      <SupportConversationScreen conversationId={CONVERSATION_ID} />,
      { api },
    );

    await user.type(await screen.findByLabelText('Message'), 'Are you open now?');
    await user.press(screen.getByRole('button', { name: 'Send message' }));

    expect(await screen.findByText(/Not sent/)).toBeOnTheScreen();
    expect(screen.getByText('Are you open now?')).toBeOnTheScreen();

    api.sendChatMessage.mockResolvedValueOnce({
      message: storedMessage(2, 'Are you open now?'),
      duplicate: false,
      unread: 0,
    });
    await user.press(screen.getByRole('button', { name: 'Retry sending this message' }));

    await waitFor(() => expect(screen.queryByText(/Not sent/)).not.toBeOnTheScreen());
    const attempts = api.sendChatMessage.mock.calls.map(
      (call) => (call[2] as { clientMessageId: string }).clientMessageId,
    );
    expect(attempts).toHaveLength(2);
    // The same id on both attempts: the server can tell a retry from a second message.
    expect(attempts[0]).toBe(attempts[1]);
  });
});
