import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ChatAttachment } from '@nilzora/contracts';
import { ChatAttachmentList } from './chat-attachments';

/*
 * The files a chat message carries, as both the customer's widget and the Communication Center
 * draw them. The API already resolved each URL, so this only decides which of the three shapes
 * is shown and what happens when a URL is missing.
 *
 * `FULL` and `THUMB` are the exact paths the API emits: chat uploads are private, so there is no
 * bucket address and no object key — each app points them at its own authorized media proxy
 * before they reach an `<img>`, a player or a download link.
 */
const FULL = '/chat/attachments/11111111-1111-4111-8111-111111111111/media';
const THUMB = `${FULL}?variant=thumb`;

function attachment(overrides: Partial<ChatAttachment> = {}): ChatAttachment {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    fileName: 'parcel.webp',
    contentType: 'image/webp',
    byteSize: 2048,
    width: 800,
    height: 600,
    durationMs: null,
    url: FULL,
    thumbnailUrl: THUMB,
    ...overrides,
  };
}

describe('ChatAttachmentList', () => {
  it('renders nothing for a message without attachments', () => {
    const { container } = render(<ChatAttachmentList attachments={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it('shows a picture as its thumbnail and opens the full one in place', () => {
    render(<ChatAttachmentList attachments={[attachment()]} />);

    const image = screen.getByAltText<HTMLImageElement>('parcel.webp');
    expect(image.getAttribute('src')).toBe(THUMB);

    fireEvent.click(screen.getByRole('button', { name: /parcel\.webp/ }));

    const dialog = screen.getByRole('dialog');
    const full = within(dialog).getByRole('img', { name: 'parcel.webp' });
    expect(full.getAttribute('src')).toBe(FULL);
    // The stored address is never offered as a link, printed or put in a tooltip.
    expect(within(dialog).queryByRole('link')).toBeNull();
    expect(dialog.textContent).not.toContain(FULL);
    expect(dialog.querySelector('[title]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Close the picture' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says a picture could not load, and asks for it again when the reader retries', () => {
    render(<ChatAttachmentList attachments={[attachment()]} />);

    fireEvent.error(screen.getByAltText('parcel.webp'));

    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(screen.queryByAltText('parcel.webp')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.getByAltText<HTMLImageElement>('parcel.webp').getAttribute('src')).toBe(THUMB);
  });

  it('says a recording could not load, and asks for it again when the reader retries', () => {
    render(
      <ChatAttachmentList
        attachments={[
          attachment({
            fileName: 'voice.webm',
            contentType: 'audio/webm',
            width: null,
            height: null,
            durationMs: 12_000,
            url: FULL,
            thumbnailUrl: null,
          }),
        ]}
      />,
    );

    fireEvent.error(document.querySelector('audio') as HTMLAudioElement);

    expect(screen.getByRole('button', { name: /could not be loaded/i })).toBeTruthy();
    expect(document.querySelector('audio')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /could not be loaded/i }));

    expect(document.querySelector('audio')?.getAttribute('src')).toBe(FULL);
  });

  it('links a document for download and shows its type and size', () => {
    render(
      <ChatAttachmentList
        attachments={[
          attachment({
            fileName: 'invoice.pdf',
            contentType: 'application/pdf',
            byteSize: 40_960,
            width: null,
            height: null,
            url: FULL,
            thumbnailUrl: null,
          }),
        ]}
      />,
    );

    const link = screen.getByRole('link', { name: /invoice\.pdf/ });
    expect(link.getAttribute('href')).toBe(FULL);
    expect(link.getAttribute('download')).toBe('invoice.pdf');
    expect(link.textContent).toContain('PDF · 40 KB');
  });

  it('plays a recording where it was sent and tracks its position', () => {
    render(
      <ChatAttachmentList
        attachments={[
          attachment({
            fileName: 'voice.webm',
            contentType: 'audio/webm',
            width: null,
            height: null,
            durationMs: 72_000,
            url: FULL,
            thumbnailUrl: null,
          }),
        ]}
      />,
    );

    // A neutral player: a ringed play button, the waveform and the length the server stored.
    expect(screen.getByRole('button', { name: 'Play the voice message' })).toBeTruthy();
    expect(screen.getByText('1:12')).toBeTruthy();
    const player = document.querySelector('audio');
    expect(player?.getAttribute('src')).toBe(FULL);

    // Playing moves the elapsed time and colours the bars already played.
    Object.defineProperty(player, 'currentTime', { value: 36, configurable: true });
    fireEvent.timeUpdate(player as HTMLAudioElement);
    expect(screen.getByText('0:36 / 1:12')).toBeTruthy();
    const slider = screen.getByRole('slider', { name: 'Position in the voice message' });
    expect(slider.querySelectorAll('[data-played]')).toHaveLength(20);
    expect(slider.getAttribute('aria-valuetext')).toBe('0:36 of 1:12');
  });

  it('falls back to the name when the API could not resolve a URL', () => {
    render(
      <ChatAttachmentList
        attachments={[
          attachment({
            fileName: 'parcel.webp',
            url: null,
            thumbnailUrl: null,
          }),
        ]}
      />,
    );

    // No broken image, and nothing to follow: the file is still named.
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('parcel.webp')).toBeTruthy();
  });
});
