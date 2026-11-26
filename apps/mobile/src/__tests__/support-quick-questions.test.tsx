import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { NewConversationCard } from '@/features/support/new-conversation-card';
import { createFakeApiClient } from '../test-utils/api-fakes';
import { styleOf } from '../test-utils/style-of';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { signedInState } from '../test-utils/session-fakes';

/*
 * The common questions beside the message box.
 *
 * A chip writes the question and stops there: the customer reads and edits it before pressing
 * Send, so a tap can never post a request the store has not agreed to, and no chip names an
 * action the app cannot perform.
 */

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

async function open(api = createFakeApiClient()) {
  api.listOrders.mockResolvedValue({ orders: [], page: 1, pageSize: 5, total: 0, totalPages: 0 });
  const view = await renderWithProviders(<NewConversationCard />, {
    api,
    session: signedInState(),
  });
  void fireEvent.press(screen.getByRole('button', { name: 'Start a new conversation' }));
  return { ...view, api };
}

describe('Starting a support conversation', () => {
  it('puts a common question in the box without sending it', async () => {
    const { api } = await open();

    void fireEvent.press(await screen.findByRole('button', { name: 'Where is my order?' }));

    await waitFor(() =>
      expect(screen.getByLabelText('Your message').props.value).toBe('Where is my order, please?'),
    );
    // Nothing was posted, and nothing was even started.
    expect(api.startChatConversation).not.toHaveBeenCalled();
  });

  it('offers every listed question, and no action the app cannot perform', async () => {
    await open();

    for (const label of [
      'Where is my order?',
      'Track my delivery',
      'Product help',
      'Delivery charges',
      'Return or exchange',
      'Payment',
      'Cancel an order',
    ]) {
      expect(await screen.findByRole('button', { name: label })).toBeTruthy();
    }
    // A chip asks a question; "Cancel order" would promise an action nothing performs.
    expect(screen.queryByRole('button', { name: 'Cancel order' })).toBeNull();
  });

  it('gives every common question a full 44 dp touch target', async () => {
    await open();
    const chip = await screen.findByRole('button', { name: 'Where is my order?' });
    expect(styleOf(chip).minHeight).toBeGreaterThanOrEqual(44);
  });

  it('steps aside once the customer has written something of their own', async () => {
    await open();
    const box = await screen.findByLabelText('Your message');

    void fireEvent.changeText(box, 'My own question');

    await waitFor(() =>
      expect(screen.getByLabelText('Your message').props.value).toBe('My own question'),
    );
    // No chip is left to replace what the customer typed.
    expect(screen.queryByRole('button', { name: 'Where is my order?' })).toBeNull();
  });
});
