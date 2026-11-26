import { screen } from '@testing-library/react-native';
import { BrandMark } from '../features/brands/brand-components';
import { brand } from '../features/brands/test-fixtures';
import { renderWithProviders } from '../test-utils/render-with-providers';

/*
 * The brand mark never crops or stretches a logo: it is contained (or shown as initials when
 * there is no logo, or when the picture fails). The list tiles draw it without a second border,
 * the brand page keeps it in its white tile.
 */

jest.mock('expo-router', () => jest.requireActual<object>('@/test-utils/expo-router-mock'));

const LOGO = {
  url: 'https://media.example.test/brands/aarong/full.webp',
  thumbUrl: 'https://media.example.test/brands/aarong/thumb.webp',
};

describe('BrandMark', () => {
  it('keeps the logo whole, contained rather than cropped', async () => {
    await renderWithProviders(<BrandMark brand={brand({ logo: LOGO })} size={72} bare />);

    const image = screen.getByTestId('brand-logo');
    expect(image.props.resizeMode).toBe('contain');
    expect(image.props.source).toEqual({ uri: LOGO.thumbUrl });
  });

  it('draws the tile behind the logo only when the caller asks for one', async () => {
    const bare = await renderWithProviders(<BrandMark brand={brand({ logo: LOGO })} bare />);
    expect(JSON.stringify(bare.toJSON())).not.toContain('"borderWidth":1');
    await bare.unmount();

    const tile = await renderWithProviders(<BrandMark brand={brand({ logo: LOGO })} />);
    expect(JSON.stringify(tile.toJSON())).toContain('"borderWidth":1');
    await tile.unmount();
  });

  it('shows the initials when the brand has no logo', async () => {
    await renderWithProviders(<BrandMark brand={brand({ name: 'Deshi Threads', logo: null })} />);

    expect(screen.getByText('DT')).toBeOnTheScreen();
  });
});
