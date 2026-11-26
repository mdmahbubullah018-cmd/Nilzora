'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * The picture in a chat bubble, opened in place instead of a new tab.
 *
 * It is a native <dialog>, so the browser gives it the top layer, an inert page behind it,
 * Escape handling and focus restoration for free. A tap on the backdrop closes it, and the
 * caption shows only the picture's display name. The stored address, key and path are never
 * printed, linked or put in a tooltip or an error message.
 */

/**
 * A name that is safe to show: just the last part of whatever was given (no folders), and a plain
 * "Picture" when what is left looks like a storage key (a long hex/uuid string) rather than a name.
 */
export function safeImageName(name: string): string {
  const base = name.split(/[\\/]/).pop()?.trim() ?? '';
  if (base === '' || /^[0-9a-f-]{20,}(.[a-z0-9]{2,5})?$/i.test(base)) return 'Picture';
  return base;
}
export interface ChatImageViewerImage {
  url: string;
  name: string;
}

export interface ChatImageLightboxProps {
  image: ChatImageViewerImage | null;
  onClose: () => void;
}

export function ChatImageLightbox({ image, onClose }: ChatImageLightboxProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const nameId = useId();
  // The address that failed, not a flag: a new picture clears the old verdict on its own.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (image !== null && !dialog.open) dialog.showModal();
    else if (image === null && dialog.open) dialog.close();
  }, [image]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const onBackdrop = (event: MouseEvent) => {
      if (event.target === dialog) onClose();
    };
    dialog.addEventListener('click', onBackdrop);
    return () => dialog.removeEventListener('click', onBackdrop);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={nameId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (image !== null) onClose();
      }}
      className="nz-chat-lightbox m-auto w-screen max-w-none bg-transparent p-0 shadow-none backdrop:bg-brand-navy/90 open:flex"
    >
      {image === null ? null : (
        <div className="relative flex h-dvh w-screen flex-col items-center justify-center gap-3 p-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the picture"
            className="absolute top-4 right-4 grid size-10 place-items-center rounded-full bg-brand-navy/70 text-white transition hover:bg-brand-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <X aria-hidden className="size-5" />
          </button>
          {failedUrl === image.url ? (
            <p role="alert" className="max-w-sm text-center text-sm text-white">
              This picture could not be loaded. Please try again.
            </p>
          ) : (
            <img
              src={image.url}
              alt={safeImageName(image.name)}
              onError={() => setFailedUrl(image.url)}
              className="max-h-[80dvh] max-w-[min(92vw,64rem)] object-contain"
            />
          )}
          <div className="flex max-w-[92vw] items-center gap-3 rounded-full bg-brand-navy/70 px-4 py-2 text-xs text-white">
            <span id={nameId} className="truncate">
              {safeImageName(image.name)}
            </span>
          </div>
        </div>
      )}
    </dialog>
  );
}
