import type { ChatConversationDetail } from '@nilzora/contracts';
import { ApiError } from '@nilzora/api-client';
import { act, screen, waitFor } from '@testing-library/react-native';
import ProductScreen from '../../app/product/[slug]';
import SupportRoute from '../../app/support/index';
import {
  askAboutProduct,
  dismissProductQuestion,
  productQuestionSnapshot,
} from '@/features/support/product-question';
import { SupportInboxScreen } from '@/features/support/support-inbox-screen';
import { product, productId } from '../features/catalog/test-fixtures';
import { emptyReviews, myReview } from '../features/reviews/test-fixtures';
import { createFakeApiClient, type FakeApiClient } from '../test-utils/api-fakes';
import { resetRouterMock, router, searchParams } from '../test-utils/expo-router-mock';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { signedInState } from '../test-utils/session-fakes';

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
const CONVERSATION_ID = '00000000-0000-4000-8000-0000000000c1';
const SHIRT = product({ name: 'Cotton shirt' });
const SHIRT_ID = productId(1);

/** A conversation as the API answers it once the first message about a product is stored. */
function conversation(productName: string | null): ChatConversationDetail {
  return {
    conversation: {
      id: CONVERSATION_ID,
      kind: 'customer_support',
      status: 'open',
      priority: 'normal',
      subject: productName ?? 'Support',
      customerId: CUSTOMER_ID,
      orderId: null,
      productId: productName === null ? null : SHIRT_ID,
      assigneeId: null,
      lastMessageAt: '2026-11-05T10:00:00.000Z',
      lastMessagePreview: 'Is it true to size?',
      lastMessageSenderId: null,
      messageCount: 1,
      createdAt: '2026-11-05T09:00:00.000Z',
      updatedAt: '2026-11-05T10:00:00.000Z',
      resolvedAt: null,
      closedAt: null,
      csatRating: null,
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
    product:
      productName === null
        ? null
        : {
            id: SHIRT_ID,
            slug: SHIRT.slug,
            name: productName,
            priceMinor: SHIRT.priceMinor,
            status: 'active',
            image: null,
            variantLabel: null,
          },
    participants: [],
  };
}

function productApi(): FakeApiClient {
  const api = createFakeApiClient();
  api.getProduct.mockResolvedValue({ product: SHIRT });
  api.productReviews.mockResolvedValue(emptyReviews());
  api.myProductReview.mockResolvedValue(myReview());
  return api;
}

function inboxApi(): FakeApiClient {
  const api = createFakeApiClient();
  api.listChatConversations.mockResolvedValue({
    conversations: [],
    unread: 0,
    page: 1,
    pageSize: 30,
    total: 0,
    totalPages: 1,
  });
  api.searchChatMessages.mockResolvedValue({ hits: [] });
  return api;
}

beforeEach(() => {
  resetRouterMock();
  dismissProductQuestion();
  searchParams.slug = 'cotton-shirt';
});

describe('asking about a product', () => {
  it('carries the product from the product page into the existing support inbox', async () => {
    const { user } = await renderWithProviders(<ProductScreen />, { api: productApi() });

    await user.press(await screen.findByRole('button', { name: 'Ask about Cotton shirt' }));

    expect(router.push).toHaveBeenCalledWith('/support');
    expect(productQuestionSnapshot()).toEqual({
      productId: SHIRT_ID,
      productName: 'Cotton shirt',
    });
  });

  it('writes the first message about the recorded product and opens that conversation', async () => {
    const api = inboxApi();
    api.startChatConversation.mockResolvedValue(conversation('Cotton shirt'));
    askAboutProduct({ productId: SHIRT_ID, productName: 'Cotton shirt' });

    const { user } = await renderWithProviders(<SupportInboxScreen />, { api });

    expect(await screen.findByText('Cotton shirt')).toBeOnTheScreen();
    await user.type(
      screen.getByLabelText('Your question about Cotton shirt'),
      'Is it true to size?',
    );
    await user.press(screen.getByRole('button', { name: 'Send question' }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/support/${CONVERSATION_ID}`));
    expect(api.startChatConversation).toHaveBeenCalledWith(expect.anything(), {
      kind: 'customer_support',
      productId: SHIRT_ID,
      subject: 'Cotton shirt',
      body: 'Is it true to size?',
    });
    // The question is spent: the composer does not follow the customer into the next visit.
    expect(productQuestionSnapshot()).toBeNull();
  });

  it('will not send an empty question, and keeps the text when the API refuses', async () => {
    const api = inboxApi();
    api.startChatConversation.mockRejectedValue(new ApiError(0, 'network_error', 'offline'));
    askAboutProduct({ productId: SHIRT_ID, productName: 'Cotton shirt' });

    const { user } = await renderWithProviders(<SupportInboxScreen />, { api });

    const send = await screen.findByRole('button', { name: 'Send question' });
    expect(send).toBeDisabled();

    const input = screen.getByLabelText('Your question about Cotton shirt');
    await user.type(input, 'Does it shrink?');
    await user.press(screen.getByRole('button', { name: 'Send question' }));

    await waitFor(() => expect(api.startChatConversation).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText('Check your internet connection, then try again.'),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Your question about Cotton shirt')).toHaveDisplayValue(
      'Does it shrink?',
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('keeps the product through a sign-in round trip from the support route', async () => {
    const api = inboxApi();
    askAboutProduct({ productId: SHIRT_ID, productName: 'Cotton shirt' });

    const { user, setSession } = await renderWithProviders(<SupportRoute />, {
      api,
      session: { status: 'signed_out' },
    });

    // The gate says what the account is for, and carries the customer back to support.
    expect(
      await screen.findByText('Sign in or create an account to ask about this product.'),
    ).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/sign-in',
      params: { returnTo: '/support' },
    });

    await setSession(signedInState());

    expect(await screen.findByText('Cotton shirt')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Send question' })).toBeOnTheScreen();
  });

  it('lets the customer drop the question instead of sending it', async () => {
    const api = inboxApi();
    const { user } = await renderWithProviders(<SupportInboxScreen />, { api });
    expect(screen.queryByRole('button', { name: 'Send question' })).toBeNull();

    await act(() => {
      askAboutProduct({ productId: SHIRT_ID, productName: 'Cotton shirt' });
    });

    expect(await screen.findByText('Cotton shirt')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Dismiss this product question' }));

    await waitFor(() => expect(productQuestionSnapshot()).toBeNull());
    expect(screen.queryByRole('button', { name: 'Send question' })).toBeNull();
    expect(api.startChatConversation).not.toHaveBeenCalled();
  });

  it('keeps a generic support inbox working when no product question is waiting', async () => {
    const api = inboxApi();
    await renderWithProviders(<SupportInboxScreen />, { api });

    expect(await screen.findByText('No conversations yet')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Send question' })).toBeNull();
  });
});
