'use client';

import { cn } from '@nilzora/ui';
import { ImageOff, ImagePlus, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { guidanceLine, shapeMismatch, type UploadGuidance } from '@/lib/upload-guidance';
import { MediaPicker } from './media-picker';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * An image field filled from the media library.
 *
 * The key stays visible and editable — a key pasted by hand still works, and so does a browser
 * without JavaScript — but "Choose a picture" opens the picker over this page: the library with
 * its search, and an upload that adds a picture and selects it, all without leaving the form.
 * Nothing is uploaded to this record and nothing is saved until the page's own Save button runs.
 *
 * The slot's own guidance (recommended width × height, aspect ratio, formats, size limit) is
 * printed above the control, before anything is chosen, and the picture that ends up selected
 * is measured against it: a preview in the real frame shape, its actual size, and a plain
 * warning when the shape is not the one the slot shows.
 */

export interface MediaKeyFieldProps {
  /** The form field the key is posted as, e.g. `logoKey`. */
  name: string;
  label: string;
  hint: string;
  /** The key stored today, or null. */
  defaultValue: string | null;
  /**
   * The picture's public URL when the API already resolved it. Without one the field shows a
   * neutral placeholder until a picture is chosen, because only the API knows the media host.
   */
  previewUrl?: string | null;
  csrf: CsrfInput;
  maxLength?: number;
  /**
   * What the field posts. Most image fields take a media library key; a few older columns
   * (a variant's picture) store the address itself.
   */
  valueKind?: 'key' | 'url';
  /** What this slot's picture has to be, printed under the control (size, ratio, limits). */
  guidance?: UploadGuidance;
}

export function MediaKeyField({
  name,
  label,
  hint,
  defaultValue,
  previewUrl = null,
  csrf,
  maxLength = 180,
  valueKind = 'key',
  guidance,
}: MediaKeyFieldProps) {
  const tx = useTx();
  const [key, setKey] = useState(defaultValue ?? '');
  const [preview, setPreview] = useState<string | null>(previewUrl);
  /** The selected picture's real size, once the browser has opened it. */
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /** The key the preview belongs to, so typing a different key never shows a wrong picture. */
  const previewKey = useRef(defaultValue ?? '');
  const id = `${name}-media`;
  /** The frame this slot is shown in, from its guidance (12:5 for a campaign banner). */
  const frame = guidance?.shapes[0]?.aspect ?? null;
  const mismatch =
    guidance === undefined || size === null
      ? null
      : shapeMismatch(guidance, size.width, size.height);
  const offShape = mismatch !== null && mismatch > 0.08;

  const apply = (next: string, nextPreview: string | null) => {
    setKey(next);
    setPreview(nextPreview);
    setSize(null);
    previewKey.current = next;
    if (inputRef.current) inputRef.current.value = next;
  };

  const clear = () => apply('', null);

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {guidance === undefined ? null : (
        <div className="grid gap-1 rounded-xl bg-info-soft/50 px-3 py-2">
          <p className="text-xs font-semibold text-foreground">
            <AutoText value={guidanceLine(guidance)} />
          </p>
          <p className="text-xs text-muted-foreground">
            <AutoText value={guidance.note} />
          </p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        <AutoText value={hint} />
      </p>

      <div className="flex items-start gap-3">
        <div
          className={cn(
            'grid shrink-0 place-items-center overflow-hidden rounded-xl border bg-surface text-muted-foreground',
            preview === null
              ? 'size-16 border-dashed border-input-border bg-neutral-soft'
              : 'border-hairline',
          )}
          // Always a bounded box. A slot with a known frame shows that frame (12:5 for a
          // campaign banner); anything else is a plain 6rem square, so a 1200px picture can never
          // stretch the field to its natural size — the picture is cropped to the box instead.
          style={{ width: '6rem', aspectRatio: frame ?? '1 / 1' }}
        >
          {preview === null ? (
            <ImageOff aria-hidden="true" className="size-5" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- served from the media origin, unknown at build time
            <img
              src={preview}
              alt=""
              className="size-full object-cover"
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalWidth > 0 && naturalHeight > 0) {
                  setSize({ width: naturalWidth, height: naturalHeight });
                }
              }}
            />
          )}
        </div>

        <div className="grid min-w-0 flex-1 gap-2">
          <input
            ref={inputRef}
            id={id}
            name={name}
            defaultValue={defaultValue ?? ''}
            maxLength={maxLength}
            onChange={(event) => {
              const next = event.target.value.trim();
              setKey(event.target.value);
              if (next !== previewKey.current) setPreview(null);
            }}
            placeholder={tx('Choose a picture, or paste a media key')}
            className="w-full rounded-xl border border-input-border bg-surface px-3 py-2 text-sm max-sm:h-11"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(true);
              }}
              aria-haspopup="dialog"
              className="inline-flex items-center gap-1.5 rounded-xl border border-input-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-neutral-soft max-sm:min-h-11"
            >
              <ImagePlus aria-hidden="true" className="size-4" />
              {key === '' ? 'Choose a picture' : 'Change picture'}
            </button>
            {key === '' ? null : (
              <button
                type="button"
                onClick={clear}
                className="inline-flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground max-sm:min-h-11"
              >
                <X aria-hidden="true" className="size-4" />
                <AutoText>Remove</AutoText>
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Opens the library and an upload here, so nothing typed on this page is lost.
            {guidance === undefined
              ? ''
              : ` Uploads are cropped to ${guidance.ratioLabel} before they are saved.`}
          </p>
          {size === null ? null : (
            <p className="text-xs text-muted-foreground tabular-nums">
              Selected picture: {size.width} × {size.height} px
            </p>
          )}
          {offShape && guidance !== undefined ? (
            <p role="alert" className="text-xs text-warning-ink">
              This picture is {size?.width ?? 0} × {size?.height ?? 0} px, but this spot shows it at{' '}
              {guidance.ratioLabel}
              {guidance.recommended === null
                ? ''
                : ` (${String(guidance.recommended.width)} × ${String(guidance.recommended.height)} px)`}
              , so its edges will be cut. Choose a {guidance.ratioLabel} picture to fill the frame
              exactly.
            </p>
          ) : null}
        </div>
      </div>

      <MediaPicker
        open={open}
        onOpenChange={setOpen}
        csrf={csrf}
        selectedKey={key.trim()}
        valueKind={valueKind}
        guidance={guidance}
        onPick={(picture) => {
          apply(valueKind === 'url' ? picture.url : picture.key, picture.thumbUrl);
        }}
      />
    </div>
  );
}
