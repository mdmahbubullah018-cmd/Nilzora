import { screen, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import { SupportConversationScreen } from '@/features/support/conversation-screen';
import { FakeDocumentPicker } from '../test-utils/document-picker-fake';
import { FakeAudioRecorder } from '../test-utils/audio-recorder-fake';
import { renderWithProviders } from '../test-utils/render-with-providers';
import {
  ATTACHMENT_ID,
  CONVERSATION_ID,
  attachment,
  customerMessage,
  storedMessage,
  supportApi,
  uploadedAttachment,
} from '../test-utils/support-fixtures';
import {
  FakeUploadTask,
  capture,
  choose,
  chooseNothing,
  fakeAsset,
  inAct,
  lastTask,
  launchCameraAsync,
  launchImageLibraryAsync,
  permissions,
} from '../test-utils/upload-fakes';

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

type View = Awaited<ReturnType<typeof renderWithProviders>>;

beforeAll(() => {
  process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.nilzora.test';
});

beforeEach(() => {
  FakeUploadTask.reset();
  FakeDocumentPicker.reset();
  FakeDocumentPicker.calls.length = 0;
  FakeAudioRecorder.reset();
  launchImageLibraryAsync.mockReset();
  launchCameraAsync.mockReset();
  permissions(true);
});

async function open(api = supportApi()): Promise<View & { api: ReturnType<typeof supportApi> }> {
  const view = await renderWithProviders(
    <SupportConversationScreen conversationId={CONVERSATION_ID} />,
    { api },
  );
  await screen.findByRole('header', { name: 'Where is my order?' });
  return { ...view, api };
}

async function attach(user: View['user'], option: 'Photo library' | 'Camera' | 'Files') {
  await user.press(await screen.findByRole('button', { name: 'Attach' }));
  await user.press(await screen.findByRole('button', { name: option }));
}

describe('the microphone and the send button', () => {
  it('shows the microphone while there is nothing to send, and swaps to Send for text', async () => {
    const { user } = await open();

    expect(screen.getByRole('button', { name: 'Record a voice message' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeOnTheScreen();

    await user.type(screen.getByLabelText('Message'), 'Hi');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Record a voice message' })).not.toBeOnTheScreen();

    // Clearing the text brings the microphone back.
    await user.clear(screen.getByLabelText('Message'));
    expect(screen.getByRole('button', { name: 'Record a voice message' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeOnTheScreen();
  });

  it('treats a selected file like text: Send appears, and the microphone returns when it is removed', async () => {
    choose(fakeAsset({ fileName: 'a.png', mimeType: 'image/png', uri: 'file:///cache/a.png' }));
    const { user } = await open();

    await attach(user, 'Photo library');
    expect(await screen.findByRole('button', { name: 'Send message' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Record a voice message' })).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Remove a.png' }));
    expect(await screen.findByRole('button', { name: 'Record a voice message' })).toBeOnTheScreen();
  });

  it('never asks for the microphone until the mic is tapped', async () => {
    const { user } = await open();
    await user.type(screen.getByLabelText('Message'), 'Hi');
    await user.clear(screen.getByLabelText('Message'));

    expect(FakeAudioRecorder.permissionRequests).toBe(0);
    await user.press(screen.getByRole('button', { name: 'Record a voice message' }));
    await waitFor(() => expect(FakeAudioRecorder.permissionRequests).toBe(1));
  });
});

describe('the attach sheet', () => {
  it('opens the camera from the Camera option and adds a preview chip', async () => {
    capture(fakeAsset({ fileName: 'shot.jpg', uri: 'file:///cache/shot.jpg', fileSize: 3000 }));
    const { user } = await open();

    await attach(user, 'Camera');

    expect(await screen.findByText('shot.jpg')).toBeOnTheScreen();
    expect(screen.getByText('3 KB')).toBeOnTheScreen();
    expect(launchCameraAsync).toHaveBeenCalledTimes(1);
  });

  it('offers only as many pictures as the message still has room for', async () => {
    choose(
      fakeAsset({ fileName: 'a.jpg', uri: 'file:///cache/a.jpg' }),
      fakeAsset({ fileName: 'b.jpg', uri: 'file:///cache/b.jpg' }),
    );
    chooseNothing();
    const { user } = await open();

    await attach(user, 'Photo library');
    expect(await screen.findByText('2 of 5 ready to send')).toBeOnTheScreen();
    expect(launchImageLibraryAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectionLimit: 5, allowsMultipleSelection: true }),
    );

    await attach(user, 'Photo library');
    expect(launchImageLibraryAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ selectionLimit: 3 }),
    );
  });

  it('limits the file browser to the five accepted document types and shows name, type and size', async () => {
    FakeDocumentPicker.next({
      name: 'invoice.pdf',
      mimeType: 'application/pdf',
      size: 2 * 1024 * 1024,
      uri: 'file:///cache/invoice.pdf',
    });
    const { user } = await open();

    await attach(user, 'Files');

    expect(await screen.findByText('invoice.pdf')).toBeOnTheScreen();
    expect(screen.getByText('PDF · 2.0 MB')).toBeOnTheScreen();
    const options = FakeDocumentPicker.calls[0] as { type: string[] };
    expect(options.type).toHaveLength(5);
    expect(options.type).toContain('application/pdf');
    expect(options.type).not.toContain('image/png');
  });

  it('says why a document is refused: too large, or not an accepted type', async () => {
    FakeDocumentPicker.next({
      name: 'huge.pdf',
      mimeType: 'application/pdf',
      size: 21 * 1024 * 1024,
      uri: 'file:///cache/huge.pdf',
    });
    const { user } = await open();
    await attach(user, 'Files');
    expect(await screen.findByText('That file is larger than 20 MB.')).toBeOnTheScreen();

    FakeDocumentPicker.next({
      name: 'setup.exe',
      mimeType: 'application/x-msdownload',
      size: 1024,
      uri: 'file:///cache/setup.exe',
    });
    await attach(user, 'Files');
    expect(await screen.findByText(/Attach a PDF, TXT, CSV, DOCX or XLSX/)).toBeOnTheScreen();
    expect(screen.queryByText('setup.exe')).not.toBeOnTheScreen();
  });

  it('refuses a picture over 10 MB with its limit', async () => {
    choose(fakeAsset({ fileSize: 11 * 1024 * 1024 }));
    const { user } = await open();

    await attach(user, 'Photo library');

    expect(await screen.findByText('That picture is larger than 10 MB.')).toBeOnTheScreen();
  });

  it('accepts a photo whose picker reported no size, instead of calling it empty', async () => {
    choose({
      ...fakeAsset({ fileName: 'nosize.jpg', uri: 'file:///cache/nosize.jpg' }),
      fileSize: undefined as unknown as number,
    });
    const { user } = await open();

    await attach(user, 'Photo library');

    expect(await screen.findByText('nosize.jpg')).toBeOnTheScreen();
    expect(screen.queryByText(/is empty/)).not.toBeOnTheScreen();
  });
});

describe('uploading and retrying', () => {
  it('shows the real byte progress on the file’s own chip', async () => {
    choose(fakeAsset({ fileName: 'a.jpg', uri: 'file:///cache/a.jpg' }));
    const { user } = await open();
    await attach(user, 'Photo library');
    await user.press(await screen.findByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(FakeUploadTask.all).toHaveLength(1));

    await inAct(() => lastTask().progress(256, 1024));

    expect(await screen.findByText('Uploading 25%')).toBeOnTheScreen();
  });

  it('retries only the file that failed, and sends without uploading the others again', async () => {
    choose(
      fakeAsset({ fileName: 'one.jpg', uri: 'file:///cache/one.jpg' }),
      fakeAsset({ fileName: 'two.jpg', uri: 'file:///cache/two.jpg' }),
    );
    const SECOND = '00000000-0000-4000-8000-0000000000a2';
    const { user, api } = await open();
    await attach(user, 'Photo library');
    await user.press(await screen.findByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(FakeUploadTask.all).toHaveLength(1));
    lastTask().answer(201, uploadedAttachment());
    await waitFor(() => expect(FakeUploadTask.all).toHaveLength(2));
    lastTask().fail();

    // The first stays uploaded; the second says why and has its own retry.
    expect(await screen.findByText('Uploaded')).toBeOnTheScreen();
    expect(await screen.findByText(/connection was lost/)).toBeOnTheScreen();
    expect(api.postChatMessage).not.toHaveBeenCalled();

    await user.press(screen.getByRole('button', { name: 'Retry uploading two.jpg' }));
    await waitFor(() => expect(FakeUploadTask.all).toHaveLength(3));
    lastTask().answer(201, uploadedAttachment({ id: SECOND }));
    await waitFor(() => expect(screen.getAllByText('Uploaded')).toHaveLength(2));

    // Sending now uploads nothing and posts both ids.
    await user.press(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() =>
      expect(api.postChatMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ attachmentIds: [ATTACHMENT_ID, SECOND] }),
      ),
    );
    expect(FakeUploadTask.all).toHaveLength(3);
  });

  it('retries only the post, with the same client id and no new upload, when posting failed', async () => {
    choose(fakeAsset({ fileName: 'one.jpg', uri: 'file:///cache/one.jpg' }));
    const api = supportApi();
    api.postChatMessage.mockRejectedValueOnce(new Error('offline'));
    const { user } = await open(api);
    await attach(user, 'Photo library');
    await user.press(await screen.findByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(FakeUploadTask.all).toHaveLength(1));
    lastTask().answer(201, uploadedAttachment());

    expect(await screen.findByText(/Not sent/)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Retry sending this message' }));

    await waitFor(() => expect(api.postChatMessage).toHaveBeenCalledTimes(2));
    const [first, second] = api.postChatMessage.mock.calls.map((call) => call[1]);
    expect(second?.clientMessageId).toBe(first?.clientMessageId);
    expect(second?.attachmentIds).toEqual([ATTACHMENT_ID]);
    // The picture was uploaded once and never again.
    expect(FakeUploadTask.all).toHaveLength(1);
    await waitFor(() => expect(screen.queryByText(/Not sent/)).not.toBeOnTheScreen());
  });
});

describe('a sent picture appears once', () => {
  it('draws one bubble, without the file name the database stores as its body', async () => {
    choose(fakeAsset({ fileName: 'one.jpg', uri: 'file:///cache/one.jpg' }));
    const api = supportApi();
    api.postChatMessage.mockResolvedValue({
      message: {
        id: '00000000-0000-4000-8000-0000000000d9',
        seq: 1,
        senderId: '00000000-0000-4000-8000-0000000000b1',
        senderRole: 'customer',
        senderName: 'Customer',
        kind: 'text',
        body: 'receipt.webp',
        replyToId: null,
        metadata: {},
        createdAt: '2026-11-05T10:01:00.000Z',
      },
      duplicate: false,
      unreadCount: 0,
      attachments: [attachment({ fileName: 'receipt.webp' })],
    });
    api.chatAttachmentMedia.mockResolvedValue({
      bytes: new Uint8Array([1]),
      fileName: 'receipt.webp',
      contentType: 'image/webp',
    });
    const { user } = await open(api);
    await attach(user, 'Photo library');
    await user.press(await screen.findByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(FakeUploadTask.all).toHaveLength(1));
    lastTask().answer(201, uploadedAttachment());

    await waitFor(() => expect(screen.queryByText('Sending…')).not.toBeOnTheScreen());
    expect(await screen.findAllByTestId(/^message-0000/)).toHaveLength(1);
    expect(screen.queryByText('receipt.webp')).not.toBeOnTheScreen();
  });

  it('shows words the customer wrote beside a file, and hides only the synthetic body', async () => {
    const withWords = customerMessage(1, {
      body: 'This is the damaged box',
      attachments: [attachment({ fileName: 'box.webp', thumbnailUrl: null, url: null })],
    });
    const synthetic = customerMessage(2, {
      body: 'invoice.pdf',
      attachments: [
        attachment({
          id: '00000000-0000-4000-8000-0000000000a2',
          fileName: 'invoice.pdf',
          contentType: 'application/pdf',
          thumbnailUrl: null,
          url: null,
        }),
      ],
    });
    await open(supportApi({ messages: [withWords, synthetic] }));

    expect(await screen.findByText('This is the damaged box')).toBeOnTheScreen();
    // The file card still names the document; the bubble text does not repeat it.
    expect(screen.getAllByText('invoice.pdf')).toHaveLength(1);
  });

  it('shows a reply quote of a file message as "Attachment", not as its file names', async () => {
    const file = customerMessage(1, {
      body: 'shot.webp',
      attachments: [attachment({ fileName: 'shot.webp', thumbnailUrl: null, url: null })],
    });
    const answer = storedMessage(2, {
      body: 'Got it',
      replyToId: file.id,
      replyTo: {
        id: file.id,
        seq: 1,
        senderId: file.senderId,
        senderRole: 'customer',
        senderName: 'Customer',
        kind: 'text',
        body: 'shot.webp',
        hasAttachment: true,
        deleted: false,
      },
    });
    await open(supportApi({ messages: [file, answer] }));

    expect(await screen.findByText('Attachment')).toBeOnTheScreen();
  });
});

describe('opening a document', () => {
  it('downloads it with the account token and hands the local copy to the share sheet', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    const doc = storedMessage(1, {
      body: 'invoice.pdf',
      attachments: [
        attachment({
          fileName: 'invoice.pdf',
          contentType: 'application/pdf',
          thumbnailUrl: null,
          byteSize: 3000,
        }),
      ],
    });
    const api = supportApi({ messages: [doc] });
    api.chatAttachmentMedia.mockResolvedValue({
      bytes: new Uint8Array([37, 80, 68, 70]),
      fileName: 'invoice.pdf',
      contentType: 'application/pdf',
    });
    const { user } = await open(api);

    expect(await screen.findByText('PDF · 3 KB')).toBeOnTheScreen();
    await user.press(await screen.findByLabelText('Open invoice.pdf'));

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(api.chatAttachmentMedia).toHaveBeenCalledWith(expect.anything(), ATTACHMENT_ID, 'full');
    const shared = share.mock.calls[0]?.[0] as { url: string };
    // A private cache file, not a relative API path the platform could not open.
    expect(shared.url).toMatch(/^file:\/\/\/cache\//);
    share.mockRestore();
  });

  it('says so on the card when the download fails', async () => {
    const doc = storedMessage(1, {
      body: 'invoice.pdf',
      attachments: [
        attachment({ fileName: 'invoice.pdf', contentType: 'application/pdf', thumbnailUrl: null }),
      ],
    });
    const api = supportApi({ messages: [doc] });
    api.chatAttachmentMedia.mockRejectedValue(new Error('gone'));
    const { user } = await open(api);

    await user.press(await screen.findByLabelText('Open invoice.pdf'));

    expect(
      await screen.findByText('The file could not be downloaded. Try again.'),
    ).toBeOnTheScreen();
  });
});

describe('"Was this helpful?"', () => {
  const customer = customerMessage(1, { body: 'Where is my parcel?' });
  const reply = storedMessage(2, { body: 'It ships today.' });
  const lastReply = storedMessage(3, { body: 'Anything else?' });
  const resolvedDetail = {
    resolvedAt: '2026-11-05T11:00:00.000Z',
    lastCustomerMessageAt: '2026-11-05T10:00:00.000Z',
  };

  function feedbackApi(
    overrides: Parameters<typeof supportApi>[0] = {},
    answered: { messageId: string; verdict: 'helpful' | 'not_helpful' }[] = [],
  ) {
    const api = supportApi({ messages: [customer, reply, lastReply], ...overrides });
    api.listMyChatFeedback.mockResolvedValue({ feedback: answered });
    return api;
  }

  it('asks once, under the last support reply of a resolved conversation', async () => {
    await open(feedbackApi({ status: 'resolved', detail: resolvedDetail }));

    expect(await screen.findAllByText('Was this helpful?')).toHaveLength(1);
    // Yes and No only: there is no free-text note in the app.
    expect(screen.getByRole('button', { name: 'Mark this reply helpful' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Mark this reply not helpful' })).toBeOnTheScreen();
    expect(screen.queryByText(/add a note/i)).not.toBeOnTheScreen();
  });

  it('also asks for a closed conversation', async () => {
    await open(
      feedbackApi({ status: 'closed', detail: { resolvedAt: null, lastCustomerMessageAt: null } }),
    );

    expect(await screen.findAllByText('Was this helpful?')).toHaveLength(1);
  });

  it('never asks while the conversation is open or pending', async () => {
    for (const status of ['open', 'pending'] as const) {
      const api = feedbackApi({ status, detail: resolvedDetail });
      const view = await open(api);
      expect(await screen.findByText('Anything else?')).toBeOnTheScreen();
      // Open threads do not even read the verdicts.
      expect(api.listMyChatFeedback).not.toHaveBeenCalled();
      expect(screen.queryByText('Was this helpful?')).not.toBeOnTheScreen();
      await view.unmount();
    }
  });

  it('stops asking once the customer has written since it was resolved', async () => {
    await open(
      feedbackApi({
        status: 'resolved',
        detail: { ...resolvedDetail, lastCustomerMessageAt: '2026-11-05T11:30:00.000Z' },
      }),
    );

    expect(await screen.findByText('Anything else?')).toBeOnTheScreen();
    expect(screen.queryByText('Was this helpful?')).not.toBeOnTheScreen();
  });

  it('never asks about automation, system lines or order events', async () => {
    const noise = [
      customer,
      reply,
      storedMessage(3, {
        kind: 'automated',
        senderRole: 'system',
        senderId: null,
        senderName: null,
      }),
      storedMessage(4, { kind: 'system', senderRole: 'system', body: 'Closed by Rumana' }),
      storedMessage(5, { kind: 'order_event', senderRole: 'system', body: 'Order shipped' }),
    ];
    await open(feedbackApi({ messages: noise, status: 'resolved', detail: resolvedDetail }));

    // The one prompt sits under the last real reply, not under the lines after it.
    expect(await screen.findAllByText('Was this helpful?')).toHaveLength(1);
    expect(screen.getByText('Order shipped')).toBeOnTheScreen();
  });

  it('stays hidden for a reply the customer already rated, across reloads', async () => {
    await open(
      feedbackApi({ status: 'resolved', detail: resolvedDetail }, [
        { messageId: lastReply.id, verdict: 'helpful' },
      ]),
    );

    expect(await screen.findByText('Anything else?')).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText('Was this helpful?')).not.toBeOnTheScreen());
  });

  it('sends the verdict, says thanks, and reads the stored verdicts again', async () => {
    const api = feedbackApi({ status: 'resolved', detail: resolvedDetail });
    api.submitChatMessageFeedback.mockResolvedValue({
      id: '00000000-0000-4000-8000-0000000000f9',
      messageId: lastReply.id,
      verdict: 'helpful',
      comment: null,
      createdAt: '2026-11-05T12:00:00.000Z',
      updatedAt: '2026-11-05T12:00:00.000Z',
    });
    const { user } = await open(api);

    await user.press(await screen.findByRole('button', { name: 'Mark this reply helpful' }));

    await waitFor(() =>
      expect(api.submitChatMessageFeedback).toHaveBeenCalledWith(expect.anything(), lastReply.id, {
        verdict: 'helpful',
      }),
    );
    expect(await screen.findByText(/your feedback helps us improve/)).toBeOnTheScreen();
    await waitFor(() => expect(api.listMyChatFeedback.mock.calls.length).toBeGreaterThan(1));
  });

  it('keeps the conversation rating card for a resolved conversation', async () => {
    await open(feedbackApi({ status: 'resolved', detail: resolvedDetail }));

    expect(await screen.findByText('How did we do?')).toBeOnTheScreen();
  });
});
