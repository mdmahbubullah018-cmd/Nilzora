import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatAttachmentList } from './chat-attachments';
import { ChatAttachmentSkeleton, ChatMessagesSkeleton } from './chat-skeleton';

describe('chat skeletons', () => {
  it('announces one loading status and draws every attachment shape', () => {
    const { container } = render(<ChatMessagesSkeleton />);

    expect(screen.getByRole('status', { name: 'Loading messages' })).toBeTruthy();
    // Text, picture, voice and file placeholders all appear, alternating sides.
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(10);
    expect(container.querySelector('[class*="aspect-"]')).toBeTruthy();
  });

  it('renders each attachment kind on its own', () => {
    for (const kind of ['text', 'image', 'file', 'voice'] as const) {
      const { container, unmount } = render(<ChatAttachmentSkeleton kind={kind} />);
      expect(container.firstElementChild).toBeTruthy();
      unmount();
    }
  });

  it('holds a picture’s place until it has loaded, then removes the placeholder', () => {
    const { container } = render(
      <ChatAttachmentList
        attachments={[
          {
            id: '11111111-1111-4111-8111-111111111111',
            fileName: 'parcel.webp',
            contentType: 'image/webp',
            byteSize: 100,
            width: 800,
            height: 600,
            durationMs: null,
            url: '/full.webp',
            thumbnailUrl: '/thumb.webp',
          },
        ]}
      />,
    );

    const placeholder = () => container.querySelector('span[class*="animate-pulse"]');
    expect(placeholder()).toBeTruthy();
    fireEvent.load(container.querySelector('img') as HTMLImageElement);
    expect(placeholder()).toBeNull();
  });
});
