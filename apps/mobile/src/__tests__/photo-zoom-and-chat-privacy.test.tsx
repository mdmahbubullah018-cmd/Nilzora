import { fireEvent, screen } from '@testing-library/react-native';
import { PhotoZoomViewer } from '../features/catalog/photo-zoom-viewer';
import { ChatImageViewer, safeImageName } from '../features/support/chat-image-viewer';
import { renderWithProviders } from '../test-utils/render-with-providers';

const KEY = 'chat/0f1e2d3c-4b5a-4968-8776-655443322110/aabbccdd-eeff-4011-8223-445566778899';

describe('safeImageName', () => {
  it('keeps a real name, drops folders and hides storage keys', () => {
    expect(safeImageName('parcel.webp')).toBe('parcel.webp');
    expect(safeImageName('uploads/2026/parcel.webp')).toBe('parcel.webp');
    expect(safeImageName(['C:', 'photos', 'parcel.webp'].join(String.fromCharCode(92)))).toBe(
      'parcel.webp',
    );
    expect(safeImageName(KEY)).toBe('Picture');
    expect(safeImageName('aabbccdd-eeff-4011-8223-445566778899.webp')).toBe('Picture');
    expect(safeImageName('')).toBe('Picture');
  });
});

describe('ChatImageViewer', () => {
  it('shows a safe name and never the address or key', async () => {
    await renderWithProviders(
      <ChatImageViewer
        image={{ url: 'https://media.example.test/chat/secret/key/full.webp', name: KEY }}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('Picture')).toBeOnTheScreen();
    expect(screen.queryByText(/media\.example|secret|chat\//)).not.toBeOnTheScreen();
    expect(screen.getByTestId('chat-image-full').props).toMatchObject({
      accessibilityLabel: 'Picture',
    });
  });
});

describe('PhotoZoomViewer', () => {
  const photos = [
    { url: 'https://media.example.test/a.webp', alt: 'Front' },
    { url: 'https://media.example.test/b.webp', alt: 'Back' },
  ];

  it('opens on the chosen photo and moves between photos', async () => {
    const onIndexChange = jest.fn();
    await renderWithProviders(
      <PhotoZoomViewer
        photos={photos}
        index={0}
        onIndexChange={onIndexChange}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByText('Photo 1 of 2')).toBeOnTheScreen();
    expect(screen.getByTestId('product-photo-zoom')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Next photo' }));
    expect(onIndexChange).toHaveBeenCalledWith(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Previous photo' }));
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
  });

  it('shows nothing while closed', async () => {
    await renderWithProviders(
      <PhotoZoomViewer
        photos={photos}
        index={null}
        onIndexChange={jest.fn()}
        onClose={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('product-photo-zoom')).not.toBeOnTheScreen();
  });
});
