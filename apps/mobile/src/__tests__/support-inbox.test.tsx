import type { ChatConversationSummary } from '@nilzora/contracts';
import { screen, waitFor } from '@testing-library/react-native';
import { SupportInboxScreen } from '@/features/support/support-inbox-screen';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { renderWithProviders } from '../test-utils/render-with-providers';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));
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

const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000b1';

function summary(
  id: string,
  subject: string,
  overrides: Partial<ChatConversationSummary> = {},
): ChatConversationSummary {
  return {
    id,
    kind: 'customer_support',
    status: 'open',
    priority: 'normal',
    subject,
    customerId: CUSTOMER_ID,
    customerName: 'Customer One',
    customerEmail: 'one@example.com',
    orderId: null,
    orderNumber: null,
    productId: null,
    productName: null,
    assigneeId: null,
    assigneeName: null,
    lastMessageAt: '2026-11-05T10:00:00.000Z',
    lastMessagePreview: 'Hello',
    lastMessageSenderId: null,
    messageCount: 1,
    unreadCount: 0,
    latestSeq: 1,
    createdAt: '2026-11-05T09:00:00.000Z',
    updatedAt: '2026-11-05T10:00:00.000Z',
    ...overrides,
  };
}

describe('SupportInboxScreen', () => {
  it('shows unread counts and loads the next page without repeating a conversation', async () => {
    const api = createFakeApiClient();
    api.listChatConversations
      .mockResolvedValueOnce({
        conversations: [
          summary('00000000-0000-4000-8000-0000000000c1', 'Delivery to Sylhet', {
            unreadCount: 3,
          }),
          summary('00000000-0000-4000-8000-0000000000c2', 'Return question'),
        ],
        unread: 3,
        page: 1,
        pageSize: 30,
        total: 45,
        totalPages: 2,
      })
      // The API may repeat a conversation that moved between readings; the list must not.
      .mockResolvedValueOnce({
        conversations: [
          summary('00000000-0000-4000-8000-0000000000c2', 'Return question'),
          summary('00000000-0000-4000-8000-0000000000c3', 'Where is my parcel?'),
        ],
        unread: 3,
        page: 2,
        pageSize: 30,
        total: 45,
        totalPages: 2,
      });
    api.searchChatMessages.mockResolvedValue({ hits: [] });

    const { user } = await renderWithProviders(<SupportInboxScreen />, { api });

    expect(await screen.findByText('Delivery to Sylhet')).toBeOnTheScreen();
    expect(screen.getByText('3')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Load more conversations' }));

    expect(await screen.findByText('Where is my parcel?')).toBeOnTheScreen();
    await waitFor(() => expect(screen.getAllByText('Return question')).toHaveLength(1));

    expect(api.listChatConversations).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ page: 2, pageSize: 30 }),
    );
    // The last page is on screen, so the control is gone.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load more conversations' })).toBeNull(),
    );
  });
});


