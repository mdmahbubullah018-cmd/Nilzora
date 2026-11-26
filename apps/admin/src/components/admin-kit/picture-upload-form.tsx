'use client';

import { Button, cn, UploadProgress, useProgressUpload } from '@nilzora/ui';
import { Crop, ImagePlus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { CropDialog } from '@/components/catalog/crop-dialog';
import { checkReportedFile } from '@/components/catalog/image-upload';
import {
  guidanceLine,
  shapeMismatch,
  uploadGuidance,
  type BannerPlacement,
  type UploadGuidance,
} from '@/lib/upload-guidance';
import { uploadEndpoint, type UploadKind } from '@/lib/upload-routes';
import type { ActionState } from './act';
import { ActionFeedback } from './action-feedback';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

const IDLE: ActionState = { status: 'idle' };
const ACCEPT = 'image/jpeg,image/png,image/webp';

interface Picked {
  file: File;
  url: string;
  /** Null until the browser has opened the picture. */
  width: number | null;
  height: number | null;
  /** True once it went through the crop dialog. */
  edited: boolean;
}

/** Reads a picture's size from its object URL; null when the browser cannot open it. */
function measure(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

/** Puts a file into a file input, so the no-JavaScript path and `required` see it too. */
function setInputFile(input: HTMLInputElement | null, file: File | null) {
  if (!input) return;
  try {
    const transfer = new DataTransfer();
    if (file) transfer.items.add(file);
    input.files = transfer.files;
  } catch {
    // Older browsers cannot assign files; the upload still sends the picked file itself.
  }
}

/**
 * Uploads a picture to one upload slot.
 *
 * - Pick, or drag a picture onto the area. The picture is shown with its real size, checked
 *   against the API's limits, and compared with the shape the slot is shown in.
 * - "Crop or rotate" opens the crop dialog with the slot's own shapes (never a stretch).
 * - With JavaScript it goes to the upload route and shows real byte progress, with cancel and
 *   retry; without it the form posts to `action`, the same Server Action the route runs.
 */
export function PictureUploadForm({
  kind,
  idName,
  idValue,
  csrf,
  label,
  action: serverAction,
  hint,
  placement,
  guidance: given,
  onUploaded,
}: {
  kind: Exclude<UploadKind, 'product-video'>;
  /** The hidden field naming the record the picture belongs to; omitted for the caller's own. */
  idName?: string;
  idValue?: string;
  csrf: CsrfInput;
  label: string;
  /** Extra words under the guidance (where the picture appears, for instance). */
  hint?: string;
  /** Banners only: the guidance depends on where the banner is shown. */
  placement?: BannerPlacement;
  /** Overrides the slot's guidance. */
  guidance?: UploadGuidance;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  /** Hands the stored picture back, so a picker can select it instead of reloading the page. */
  onUploaded?: (picture: { key: string; url: string; thumbUrl: string }) => void;
}) {
  const tx = useTx();
  const guidance = given ?? uploadGuidance(kind, placement);
  const [state, action, pending] = useActionState(serverAction, IDLE);
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [original, setOriginal] = useState<File | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [cropping, setCropping] = useState(false);
  const id = useId();
  const errorId = `${id}-error`;
  const guideId = `${id}-guide`;

  // The preview's object URL is released when the picture changes or the form goes away.
  useEffect(() => {
    const url = picked?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [picked?.url]);

  const clear = () => {
    setOriginal(null);
    setPicked(null);
    setFileError(null);
    setInputFile(inputRef.current, null);
  };

  const upload = useProgressUpload({
    endpoint: uploadEndpoint(kind),
    onSuccess: (answer) => {
      formRef.current?.reset();
      clear();
      const values = answer.values;
      const key = values?.mediaKey;
      if (typeof key === 'string' && key !== '') {
        onUploaded?.({
          key,
          url: values?.mediaUrl ?? '',
          thumbUrl: values?.mediaThumbUrl ?? '',
        });
      }
      // The page lists the new picture; the upload panel keeps its own success message.
      router.refresh();
    },
  });
  const busy = pending || upload.busy;

  /** The file most recently taken: a slow measurement of an earlier one is ignored. */
  const latest = useRef<File | null>(null);

  const take = (file: File, edited: boolean) => {
    upload.reset();
    latest.current = file;
    if (!edited) setOriginal(file);
    const refusal = checkReportedFile(file);
    const url = URL.createObjectURL(file);
    // Shown at once; the size follows as soon as the browser has opened the picture.
    setPicked({ file, url, width: null, height: null, edited });
    setFileError(refusal);
    setInputFile(inputRef.current, file);
    if (refusal) return;
    void measure(url).then((size) => {
      if (latest.current !== file) return;
      if (!size) {
        setFileError(
          'This file could not be opened as a picture. Choose a JPEG, PNG or WebP file.',
        );
        return;
      }
      setPicked((current) => (current?.file === file ? { ...current, ...size } : current));
      if (Math.min(size.width, size.height) < guidance.minShortSide) {
        setFileError(
          `This picture is ${String(size.width)} × ${String(size.height)} px; the store needs at least ${String(guidance.minShortSide)} px on the shorter side.`,
        );
      }
    });
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = event.dataTransfer.files[0];
    if (file) take(file, false);
  };

  const mismatch =
    picked && picked.width !== null && picked.height !== null
      ? shapeMismatch(guidance, picked.width, picked.height)
      : null;
  const offShape = mismatch !== null && mismatch > 0.08 && guidance.shapes.length > 1;

  return (
    <form
      ref={formRef}
      action={action}
      onSubmit={(event) => {
        if (!picked || fileError !== null) return;
        event.preventDefault();
        upload.send(event.currentTarget, picked.file);
      }}
      className="grid gap-3"
    >
      <CsrfField csrf={csrf} />
      {idName !== undefined && idValue !== undefined ? (
        <input type="hidden" name={idName} value={idValue} />
      ) : null}
      {upload.state.phase === 'idle' ? <ActionFeedback state={state} /> : null}

      <p id={guideId} className="text-xs leading-relaxed text-muted-foreground">
        {guidanceLine(guidance)}. {guidance.note}
        {hint ? ` ${hint}` : ''}
      </p>

      <label
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'grid cursor-pointer gap-1 rounded-xl border border-dashed px-4 py-4 text-sm transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring',
          dragging
            ? 'border-info-ink bg-info-soft/60'
            : 'border-input-border bg-surface hover:bg-surface-muted/60',
          busy && 'cursor-not-allowed opacity-70',
        )}
      >
        <span className="flex items-center gap-2 font-medium text-foreground">
          <ImagePlus aria-hidden="true" className="size-4 text-info-ink" strokeWidth={1.75} />
          {label}
        </span>
        <span className="text-xs text-muted-foreground">
          {picked
            ? 'Choose another picture, or drop one here.'
            : 'Choose a picture, or drop one here.'}
        </span>
        <input
          ref={inputRef}
          type="file"
          name="image"
          required
          accept={ACCEPT}
          disabled={busy}
          aria-invalid={fileError !== null || undefined}
          // The drop zone's helper sentence is inside the <label>, so name the control by the
          // label alone and describe it by the guidance line (and the error, when there is one).
          aria-label={label}
          aria-describedby={`${guideId}${fileError !== null ? ` ${errorId}` : ''}`}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            if (file) take(file, false);
            else clear();
          }}
          className="sr-only"
        />
      </label>

      {fileError !== null ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {fileError}
        </p>
      ) : null}

      {picked && upload.state.phase === 'idle' ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-surface-muted/40 p-3">
          {picked.width !== null ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL of the picked file
            <img
              src={picked.url}
              alt={tx("The picked picture")}
              className="size-20 shrink-0 rounded-lg border border-hairline bg-surface object-contain"
            />
          ) : (
            <span
              aria-hidden="true"
              className="grid size-20 shrink-0 place-items-center rounded-lg border border-hairline bg-surface text-muted-foreground"
            >
              <ImagePlus className="size-5" strokeWidth={1.5} />
            </span>
          )}
          <div className="grid min-w-0 flex-1 gap-0.5 text-sm">
            <span className="truncate font-medium text-foreground"><AutoText value={picked.file.name} /></span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {picked.width !== null && picked.height !== null
                ? `${String(picked.width)} × ${String(picked.height)} px · `
                : ''}
              {(picked.file.size / (1024 * 1024)).toFixed(1)} MB
              {picked.edited ? ' · cropped' : ''}
            </span>
            {offShape && fileError === null ? (
              <span className="text-xs text-warning-ink">
                This is not the {guidance.ratioLabel} shape this spot uses, so the edges may be cut.
                Crop it to choose what stays.
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCropping(true)}
              // A refused file (wrong type, too big, too small) cannot be fixed by cropping.
              disabled={busy || original === null || fileError !== null}
              className="max-sm:min-h-11"
            >
              <Crop aria-hidden="true" strokeWidth={1.75} /><AutoText>Crop or rotate</AutoText></Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clear}
              disabled={busy}
              className="max-sm:min-h-11"
            >
              <X aria-hidden="true" strokeWidth={1.75} /><AutoText>Remove</AutoText></Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          variant="outline"
          loading={busy}
          disabled={picked === null || fileError !== null}
          className="max-sm:min-h-11"
        >
          {upload.state.phase === 'processing' ? 'Saving…' : busy ? 'Uploading…' : 'Upload'}
        </Button>
      </div>
      <UploadProgress
        state={upload.state}
        onCancel={upload.cancel}
        onRetry={() => {
          if (picked && formRef.current) upload.send(formRef.current, picked.file);
        }}
      />

      {cropping && original ? (
        <CropDialog
          source={original}
          open
          shapes={guidance.shapes}
          minShortSide={guidance.minShortSide}
          onClose={() => setCropping(false)}
          onApply={(file, cropped) => {
            setCropping(false);
            take(file, cropped);
          }}
        />
      ) : null}
    </form>
  );
}
