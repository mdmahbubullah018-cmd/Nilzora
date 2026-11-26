'use client';

import { PRODUCT_IMAGE_MIN_SIZE } from '@nilzora/contracts';
import { Button, cn, Dialog } from '@nilzora/ui';
import { Crop, RotateCcw, RotateCw } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { checkReportedFile } from './image-upload';
import {
  CROP_PRESETS,
  cropOutputType,
  cropRect,
  croppedName,
  MAX_ZOOM,
  MIN_ZOOM,
  moveRect,
  type CropRect,
} from './image-crop';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/** One shape the dialog offers: width / height, or null for the picture's own shape. */
export interface CropShapeOption {
  key: string;
  label: string;
  aspect: number | null;
}

interface Loaded {
  /** Object URL of what the preview shows (the picture, turned when it has been rotated). */
  url: string;
  /** What is drawn when encoding: the picture itself, or a canvas holding it turned. */
  source: CanvasImageSource;
  width: number;
  height: number;
}

/** Draws the chosen part of the (possibly turned) picture and encodes it like the original. */
function encode(loaded: Loaded, rect: CropRect, original: File): Promise<File | null> {
  const canvas = document.createElement('canvas');
  canvas.width = rect.width;
  canvas.height = rect.height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  context.drawImage(
    loaded.source,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    rect.width,
    rect.height,
  );
  const type = cropOutputType(original.type);
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        resolve(blob ? new File([blob], croppedName(original.name, type), { type }) : null);
      },
      type,
      0.92,
    );
  });
}

/** The picture turned by `turns` quarter turns clockwise, on a canvas. */
function turned(image: HTMLImageElement, turns: number): HTMLCanvasElement | null {
  const quarter = ((turns % 4) + 4) % 4;
  const sideways = quarter % 2 === 1;
  const canvas = document.createElement('canvas');
  canvas.width = sideways ? image.naturalHeight : image.naturalWidth;
  canvas.height = sideways ? image.naturalWidth : image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((quarter * Math.PI) / 2);
  context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
  return canvas;
}

export interface CropDialogProps {
  /** The picture as picked (always cropped from the original, never from an earlier crop). */
  source: File;
  open: boolean;
  onClose: () => void;
  /** The cropped picture, or the original when "Original" is chosen without turning it. */
  onApply: (file: File, cropped: boolean) => void;
  /**
   * The shapes to offer, the first being the default. Left out: Original, 1:1 and 4:5, the
   * product gallery's shapes.
   */
  shapes?: readonly CropShapeOption[];
  /** The smallest accepted shorter side of the result, in pixels. */
  minShortSide?: number;
}

/**
 * Crops a picture before upload: the shapes the upload slot needs, a zoom, a quarter-turn
 * rotation, and the area moved by dragging or with the arrow keys. Everything happens in the
 * browser with a canvas; the result is checked like any picked file, and the API checks it
 * again. Nothing is stretched: every shape is cut out of the picture, never scaled into it.
 */
export function CropDialog({
  source,
  open,
  onClose,
  onApply,
  shapes = CROP_PRESETS,
  minShortSide = PRODUCT_IMAGE_MIN_SIZE,
}: CropDialogProps) {
  const tx = useTx();
  const defaultShape =
    shapes.find((shape) => shape.aspect !== null)?.key ?? shapes[0]?.key ?? 'original';
  const [base, setBase] = useState<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [preset, setPreset] = useState<string>(defaultShape);
  const [turns, setTurns] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rect, setRect] = useState<CropRect | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; rect: CropRect } | null>(null);

  const aspectOf = (key: string) => shapes.find((shape) => shape.key === key)?.aspect ?? null;
  const aspect = aspectOf(preset);

  // The picked picture, opened once.
  useEffect(() => {
    if (!open) return undefined;
    const url = URL.createObjectURL(source);
    const image = new Image();
    let alive = true;
    image.onload = () => {
      if (alive) setBase(image);
    };
    image.onerror = () => {
      if (alive) setFailed(true);
    };
    image.src = url;
    return () => {
      alive = false;
      URL.revokeObjectURL(url);
    };
  }, [open, source]);

  // What the frame works on: the picture, turned when it has been rotated.
  useEffect(() => {
    if (!base) return undefined;
    let alive = true;
    let url: string | null = null;
    const ready = (next: Omit<Loaded, 'url'>, previewUrl: string) => {
      if (!alive) return;
      setLoaded({ ...next, url: previewUrl });
      setZoom(1);
      setRect(cropRect(next.width, next.height, aspectOf(preset), 1));
    };
    if (turns % 4 === 0) {
      url = URL.createObjectURL(source);
      ready({ source: base, width: base.naturalWidth, height: base.naturalHeight }, url);
    } else {
      const canvas = turned(base, turns);
      if (!canvas) {
        // Reported from a callback, like the successful path, never during the effect itself.
        void Promise.resolve().then(() => {
          if (alive) setMessage('This browser could not turn the picture.');
        });
      } else {
        canvas.toBlob((blob) => {
          if (!blob || !alive) return;
          url = URL.createObjectURL(blob);
          ready({ source: canvas, width: canvas.width, height: canvas.height }, url);
        }, 'image/png');
      }
    }
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
    // The shape is applied by `choose`; re-running on it would reset the frame twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, turns, source]);

  const choose = (next: string) => {
    setPreset(next);
    setZoom(1);
    setMessage(null);
    if (loaded) setRect(cropRect(loaded.width, loaded.height, aspectOf(next), 1));
  };

  const rezoom = (value: number) => {
    setZoom(value);
    if (loaded && rect) {
      const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      setRect(cropRect(loaded.width, loaded.height, aspect, value, center));
    }
  };

  /** Picture pixels per screen pixel of the preview. */
  const scale = () => {
    const box = frame.current?.getBoundingClientRect();
    return loaded && box && box.width > 0 ? loaded.width / box.width : 1;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!rect) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, rect };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || !loaded) return;
    const factor = scale();
    setRect(
      moveRect(
        start.rect,
        (event.clientX - start.x) * factor,
        (event.clientY - start.y) * factor,
        loaded.width,
        loaded.height,
      ),
    );
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!rect || !loaded) return;
    const step = Math.max(1, Math.round(Math.min(loaded.width, loaded.height) * 0.02));
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      setRect(moveRect(rect, move[0], move[1], loaded.width, loaded.height));
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      rezoom(Math.min(MAX_ZOOM, zoom + 0.1));
    } else if (event.key === '-') {
      event.preventDefault();
      rezoom(Math.max(MIN_ZOOM, zoom - 0.1));
    }
  };

  const keepsShape = aspect === null;
  const tooSmall = rect !== null && Math.min(rect.width, rect.height) < minShortSide;

  const apply = async () => {
    if (!loaded || !rect) return;
    // Untouched: the original file goes as it was picked.
    if (keepsShape && turns % 4 === 0) {
      onApply(source, false);
      return;
    }
    setWorking(true);
    const whole = { x: 0, y: 0, width: loaded.width, height: loaded.height };
    const file = await encode(loaded, keepsShape ? whole : rect, source);
    setWorking(false);
    if (!file) {
      setMessage('This browser could not crop the picture. Upload the original instead.');
      return;
    }
    const refusal = checkReportedFile(file);
    if (refusal) {
      setMessage(refusal);
      return;
    }
    onApply(file, true);
  };

  const percent = (value: number, total: number) => `${String((value / total) * 100)}%`;
  const turnLabel = ['', 'Turned a quarter right', 'Turned upside down', 'Turned a quarter left'][
    ((turns % 4) + 4) % 4
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={tx("Crop the picture")}
      description={tx("Choose a shape, turn the picture if it is sideways, then drag the frame (or use the arrow keys) to pick the part to keep.")}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} className="max-sm:min-h-11"><AutoText>Cancel</AutoText></Button>
          <Button
            onClick={() => void apply()}
            loading={working}
            disabled={!loaded || tooSmall}
            className="max-sm:min-h-11"
          >
            <Crop aria-hidden="true" strokeWidth={1.75} />
            {keepsShape && turns % 4 === 0 ? 'Keep the original' : 'Use this picture'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="radiogroup" aria-label={tx("Shape")} className="flex flex-wrap gap-2">
            {shapes.map((option) => (
              <button
                key={option.key}
                type="button"
                role="radio"
                aria-checked={preset === option.key}
                onClick={() => choose(option.key)}
                className={cn(
                  'h-9 rounded-xl px-3.5 text-sm font-medium ring-1 transition-colors ring-inset max-sm:h-11',
                  preset === option.key
                    ? 'bg-info-soft text-info-ink ring-info-line'
                    : 'bg-neutral-soft text-foreground ring-hairline hover:bg-info-soft/60',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTurns((value) => value - 1)}
              disabled={!base}
              aria-label={tx("Turn the picture a quarter left")}
              className="rounded-xl max-sm:size-11"
            >
              <RotateCcw aria-hidden="true" strokeWidth={1.75} />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTurns((value) => value + 1)}
              disabled={!base}
              aria-label={tx("Turn the picture a quarter right")}
              className="rounded-xl max-sm:size-11"
            >
              <RotateCw aria-hidden="true" strokeWidth={1.75} />
            </Button>
          </div>
        </div>
        {turnLabel ? (
          <p role="status" className="text-xs text-muted-foreground">
            {turnLabel}
          </p>
        ) : null}

        {failed ? (
          <p role="alert" className="text-sm font-medium text-danger-ink"><AutoText>This picture could not be opened for cropping. Upload it as it is instead.</AutoText></p>
        ) : loaded && rect ? (
          <div className="grid justify-items-center">
            <div ref={frame} className="relative w-full max-w-lg touch-none select-none">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL of the picked file */}
              <img
                src={loaded.url}
                alt=""
                className="block h-auto w-full rounded-lg"
                draggable={false}
              />
              {keepsShape ? null : (
                <div
                  role="group"
                  tabIndex={0}
                  aria-label={`Crop area, ${String(rect.width)} by ${String(rect.height)} pixels. Use the arrow keys to move it, plus and minus to zoom.`}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  onKeyDown={onKeyDown}
                  className="absolute cursor-move rounded-sm border-2 border-surface ring-1 ring-info-ink shadow-[0_0_0_9999px_var(--color-overlay)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  style={{
                    left: percent(rect.x, loaded.width),
                    top: percent(rect.y, loaded.height),
                    width: percent(rect.width, loaded.width),
                    height: percent(rect.height, loaded.height),
                  }}
                />
              )}
            </div>
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground"><AutoText>Opening the picture…</AutoText></p>
        )}

        {keepsShape ? null : (
          <label className="grid gap-1.5 text-sm font-medium text-foreground">
            Zoom
            <input
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.05}
              value={zoom}
              onChange={(event) => rezoom(Number(event.currentTarget.value))}
              className="w-full accent-primary-action"
            />
          </label>
        )}
        {rect && loaded ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            Result: {keepsShape ? loaded.width : rect.width} ×{' '}
            {keepsShape ? loaded.height : rect.height} px
          </p>
        ) : null}
        {tooSmall ? (
          <p role="alert" className="text-sm font-medium text-warning-ink">
            The result would be smaller than {minShortSide} pixels on its shorter side, which the
            store does not accept. Zoom out or choose another shape.
          </p>
        ) : null}
        {message ? (
          <p role="alert" className="text-sm font-medium text-danger-ink">
            {message}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
