import { screen } from '@testing-library/react-native';
import { RatingCard } from '@/features/support/support-extras';
import { styleOf } from '../test-utils/style-of';
import { renderWithProviders } from '../test-utils/render-with-providers';
import { signedInState } from '../test-utils/session-fakes';

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

describe('The satisfaction rating card', () => {
  it('gives every star a full 44 dp target, five of which fit a 320 dp screen', async () => {
    await renderWithProviders(<RatingCard conversationId="c1" rating={null} />, {
      session: signedInState(),
    });
    for (let value = 1; value <= 5; value += 1) {
      const star = styleOf(screen.getByRole('button', { name: `${String(value)} out of 5` }));
      expect(star.width).toBeGreaterThanOrEqual(44);
      expect(star.height).toBeGreaterThanOrEqual(44);
    }
  });
});
