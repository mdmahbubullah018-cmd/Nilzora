'use client';

import type { PopupDisplayMode } from '@nilzora/contracts';
import { ArrowUpRight, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Dialog } from './dialog';

/**
 * The one promotional popup, drawn the same way everywhere it appears: over the storefront, in
 * the Admin's device preview, and beside the form an administrator is filling in.
 *
 * Two display modes share one frame:
 *
 *   template  a campaign picture with optional title, subtitle, description and a button. The
 *             picture fills its box (`object-cover`), because the copy beside it is the message.
 *   artwork   one complete piece of artwork — often an animated GIF — shown exactly as uploaded
 *             (`object-contain`, never cropped, never stretched). The whole picture is the link
 *             when one is configured.
 *
 * The frame reserves the artwork's own proportion from the dimensions stored with it, so the
 * popup never shifts the page as it appears and never leaves a hole while it loads. Nothing here
 * fetches or decides anything: eligibility and frequency belong to the API and to the client.
 */
export interface PromoPopupContent {
  displayMode: PopupDisplayMode;
  imageUrl: string;
  /** Pixel size of the stored artwork; used to reserve the box before it has loaded. */
  imageWidth: number;
  imageHeight: number;
  /** An animated GIF is kept byte for byte, so it is rendered as a plain picture. */
  isAnimated: boolean;
  imageAlt: string | null;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  buttonLabel: string | null;
  buttonHref: string | null;
}

export interface PromoPopupFrameProps {
  content: PromoPopupContent;
  /** Renders the close control; omit where the surrounding surface already has one. */
  onClose?: (() => void) | undefined;
  closeLabel?: string;
  /** Called when the picture fails to load, so the host can close rather than show a gap. */
  onImageError?: (() => void) | undefined;
  /** Wording the frame cannot know: the reader's language, not the artwork's. */
  promotionalLabel?: string;
  className?: string;
}

/** The picture, in a box whose shape is already known from the stored dimensions. */
function PopupArtwork({
  content,
  className,
  onImageError,
}: {
  content: PromoPopupContent;
  className?: string;
  onImageError?: (() => void) | undefined;
}) {
  const ratio =
    content.imageWidth > 0 && content.imageHeight > 0
      ? `${String(content.imageWidth)} / ${String(content.imageHeight)}`
      : undefined;
  return (
    <div
      // Complete artwork keeps its own transparency (a PNG's clear pixels show the page behind
      // the popup); a template picture sits on a soft tint until it has loaded.
      className={cn(
        'w-full overflow-hidden',
        content.displayMode === 'artwork' ? 'rounded-2xl' : 'bg-soft',
        className,
      )}
      style={ratio === undefined ? undefined : { aspectRatio: ratio }}
    >
      {/* Stored WebP, or a GIF that must stay byte-identical to keep its animation. */}
      <img
        src={content.imageUrl}
        alt={content.imageAlt ?? ''}
        width={content.imageWidth}
        height={content.imageHeight}
        decoding="async"
        // A popup appears after the delay, so its picture is fetched then rather than competing
        // with the page: `lazy` would leave it blank for a moment after it is shown.
        loading="eager"
        onError={onImageError}
        className={cn(
          'h-full w-full',
          content.displayMode === 'artwork' ? 'object-contain' : 'object-cover',
        )}
      />
    </div>
  );
}

/** The popup's action: a label with a destination, or nothing at all. */
function PopupAction({ content }: { content: PromoPopupContent }) {
  if (content.buttonLabel === null || content.buttonHref === null) return null;
  return (
    <a
      href={content.buttonHref}
      className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
    >
      {content.buttonLabel}
      <ArrowUpRight aria-hidden="true" className="size-4" />
    </a>
  );
}

/** The words beside a template picture: title, subtitle, description and the button. */
function PopupCopy({ content }: { content: PromoPopupContent }) {
  if (!hasWords(content)) return null;
  return (
    <div className="flex min-w-0 flex-col justify-center gap-1.5 p-5 sm:gap-2 sm:p-6">
      {content.title === null ? null : (
        <h2 className="font-display text-lg font-semibold text-balance text-foreground sm:text-xl">
          {content.title}
        </h2>
      )}
      {content.subtitle === null ? null : (
        <p className="text-sm font-medium text-primary">{content.subtitle}</p>
      )}
      {content.description === null ? null : (
        <p className="text-sm leading-relaxed text-muted-foreground">{content.description}</p>
      )}
      <div className="mt-1.5 empty:hidden">
        <PopupAction content={content} />
      </div>
    </div>
  );
}

/** Whether a template popup has any words of its own (a button alone is not a paragraph). */
function hasWords(content: PromoPopupContent): boolean {
  return content.title !== null || content.subtitle !== null || content.description !== null;
}

/** Whether the popup offers an action a customer can actually take. */
function hasAction(content: PromoPopupContent): boolean {
  return content.buttonLabel !== null && content.buttonHref !== null;
}

/**
 * The close control: a small glyph on a barely-there dark glass disc. It is 36px square on a
 * fine pointer and 44px on a touch one, and the soft navy tint (with a blurred edge where the
 * browser supports it) is what keeps a white icon readable on a pale picture without drawing a
 * button-shaped ring over the artwork.
 */
const CLOSE_CLASS =
  'absolute top-2 right-2 z-10 grid size-9 place-items-center rounded-full ' +
  'bg-brand-navy/45 text-white backdrop-blur-sm pointer-coarse:size-11 ' +
  'drop-shadow-[0_1px_3px_rgba(15,23,42,0.45)] transition-colors hover:bg-brand-navy/65 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ' +
  'motion-reduce:transition-none';

/**
 * The popup itself, without any modal machinery: a rounded card that the surrounding surface
 * decides how to place. Used directly by the Admin preview and by `PromoPopupDialog`.
 */
export function PromoPopupFrame({
  content,
  onClose,
  closeLabel = 'Close',
  onImageError,
  promotionalLabel = 'Promotion',
  className,
}: PromoPopupFrameProps): ReactNode {
  const close =
    onClose === undefined ? null : (
      <button type="button" onClick={onClose} aria-label={closeLabel} className={CLOSE_CLASS}>
        <X aria-hidden="true" className="size-4" strokeWidth={2.25} />
      </button>
    );

  if (content.displayMode === 'artwork') {
    const picture = <PopupArtwork content={content} onImageError={onImageError} />;
    return (
      <div
        aria-label={promotionalLabel}
        role="group"
        className={cn('relative w-full drop-shadow-2xl', className)}
      >
        {close}
        {content.buttonHref === null ? (
          picture
        ) : (
          <a
            href={content.buttonHref}
            aria-label={content.imageAlt ?? content.buttonLabel ?? promotionalLabel}
            className="block focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          >
            {picture}
          </a>
        )}
      </div>
    );
  }

  /*
   * A designed template, in whichever shape its content actually has:
   *   words + action   picture beside the words on a wide screen, picture above them on a phone
   *   action only      the picture at full size, with its action in a slim bar beneath it, so the
   *                    card never shows an empty half
   *   nothing at all   the picture alone (an admin may leave every field empty)
   */
  const words = hasWords(content);
  const action = hasAction(content);
  return (
    <div
      aria-label={promotionalLabel}
      role="group"
      className={cn(
        'relative grid w-full overflow-hidden rounded-2xl bg-surface shadow-2xl',
        words ? 'sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]' : '',
        className,
      )}
    >
      {close}
      {/* The picture keeps its own proportions on the phone's sheet; from `sm` (where it shares
          the card with the copy) it is capped so the popup never fills the whole screen. */}
      <PopupArtwork content={content} onImageError={onImageError} className="sm:max-h-[46dvh]" />
      {words ? (
        <PopupCopy content={content} />
      ) : action ? (
        <div className="flex justify-center p-4">
          <PopupAction content={content} />
        </div>
      ) : null}
    </div>
  );
}

export interface PromoPopupDialogProps extends Omit<PromoPopupFrameProps, 'className'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A short, hidden heading so the dialog has an accessible name. */
  label?: string;
  className?: string;
}

/**
 * The popup as a modal on the web: the shared frame inside the shared `Dialog`, which supplies
 * focus containment, an inert background, Escape, backdrop dismissal and focus restoration.
 * The frame draws its own close control, so the dialog adds none of its own.
 *
 * Placement is the client: a sheet that rises from the bottom edge on a phone, where a centre
 * modal is hardest to reach and furthest from the thumb, and a centred card from `sm` up.
 */
export function PromoPopupDialog({
  open,
  onOpenChange,
  label = 'Promotion',
  className,
  ...frame
}: PromoPopupDialogProps): ReactNode {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={label}
      hideTitle
      showClose={false}
      bodyClassName="p-0"
      closeLabel={frame.closeLabel ?? 'Close'}
      side="sheet"
      // Complete artwork may carry its own transparency, so the sheet gets out of its way.
      panelClassName={
        frame.content.displayMode === 'artwork' ? 'bg-transparent shadow-none' : undefined
      }
      // A little larger than the old centre modal, now that the sheet has room to be.
      className={cn('sm:max-w-3xl', className)}
    >
      <PromoPopupFrame {...frame} onClose={() => onOpenChange(false)} promotionalLabel={label} />
    </Dialog>
  );
}
