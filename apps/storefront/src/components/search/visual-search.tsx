'use client';

import type { ImageSearchResponse, ImageSearchSort, ScanResolveResponse } from '@nilzora/contracts';
import { buttonClasses, cn, Skeleton } from '@nilzora/ui';
import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Camera,
  ImagePlus,
  Loader2,
  QrCode,
  RotateCcw,
  Search,
  Sparkles,
  X,
  Zap,
  ZoomIn,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ProductCard } from '@/components/catalog/product-card';

/*
 * Visual search on the mobile website
 * -----------------------------------
 * One client component, four steps, in the order the brief asks for:
 *
 *   choose  – take a photo, pick one, or find similar from a product's own picture
 *   camera  – a live preview with two modes: Scan (QR and barcodes) and Photo
 *   crop    – the ordinary crop-and-zoom step before anything is uploaded
 *   results – the same cards as a listing, with the query picture in the header
 *
 * Everything that touches the camera is cleaned up on unmount, on the tab going hidden and on
 * every transition away from the camera step: a phone that keeps its camera light on after the
 * user left is the classic bug in this feature.
 *
 * Barcode detection happens *before* the visual search, on the cropped picture (and live in
 * Scan mode), through the browser's own BarcodeDetector. Where the browser has no detector the
 * mode says so instead of pretending, and Photo still works.
 */

type Phase = 'choose' | 'camera' | 'crop' | 'searching' | 'results';
type CameraMode = 'scan' | 'photo';

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string; format: string }[]>;
}
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const SCAN_FORMATS = [
  'qr_code',
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'itf',
  'codabar',
];

const PAGE_SIZE = 24;
/** How long a camera may take to hand over a stream before the page offers a file instead. */
const CAMERA_START_TIMEOUT_MS = 6_000;

/** Settles with the promise, or rejects with a TimeoutError once the wait is over. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new DOMException('The camera took too long to start', 'TimeoutError'));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause: unknown) => {
        clearTimeout(timer);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      },
    );
  });
}

const KIND_LABEL = {
  invalid: 'That photo could not be read. Try another one.',
  camera_unavailable: 'This browser cannot open the camera here. Choose a photo instead.',
  camera_slow: 'The camera did not start. Allow it when the browser asks, or choose a photo.',
  camera_denied: 'Camera access was blocked. Allow it in your browser settings, or choose a photo.',
  gallery_denied: 'Photo access was blocked. Allow it in your browser settings.',
  rate_limited: 'Too many image searches. Please wait a moment.',
  offline: 'You are offline. Reconnect and try again.',
  unavailable: 'Image search is not available right now. Try again shortly.',
  disabled: 'Image search is switched off at the moment.',
  no_index: 'Image search is still being prepared. Try again shortly.',
  unknown: 'Something went wrong. Try again.',
} as const;
type FailureKind = keyof typeof KIND_LABEL;

/** The API codes, mapped onto one of the messages above. */
function messageFor(status: number, code: string | undefined, retryAfter: number | null): string {
  if (status === 429) {
    return retryAfter === null
      ? KIND_LABEL.rate_limited
      : `${KIND_LABEL.rate_limited} Try again in ${retryAfter}s.`;
  }
  if (code === 'image_invalid') return KIND_LABEL.invalid;
  if (code === 'image_search_disabled') return KIND_LABEL.disabled;
  if (code === 'image_search_unavailable') return KIND_LABEL.no_index;
  if (code === 'service_unavailable' || status === 503) return KIND_LABEL.unavailable;
  if (status === 413) return 'That photo is too large. Try another one.';
  return KIND_LABEL.unknown;
}

function barcodeDetector(): BarcodeDetectorConstructor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
  return ctor ?? null;
}

export interface VisualSearchProps {
  /** A product whose own picture seeds the search ("Find similar"). */
  initialProductId?: string | undefined;
  initialImageId?: string | undefined;
  /** The product's picture, shown while the similar search runs. */
  initialThumbnail?: string | undefined;
  /** The product's name, for the header of a similar search. */
  initialProductName?: string | undefined;
}

export function VisualSearch({
  initialProductId,
  initialImageId,
  initialThumbnail,
  initialProductName,
}: VisualSearchProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(
    initialProductId === undefined ? 'camera' : 'searching',
  );
  const [mode, setMode] = useState<CameraMode>('scan');
  const [sort, setSort] = useState<ImageSearchSort>('best_match');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ImageSearchResponse | null>(null);
  const [thumbnail, setThumbnail] = useState<string | null>(initialThumbnail ?? null);
  const [source, setSource] = useState<{ productId?: string; imageId?: string } | null>(
    initialProductId === undefined
      ? null
      : { productId: initialProductId, imageId: initialImageId },
  );
  const [error, setError] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [captured, setCaptured] = useState<{ blob: Blob; url: string } | null>(null);
  const [scanSupported] = useState(() => barcodeDetector() !== null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimer = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const thumbnailRef = useRef<string | null>(initialThumbnail ?? null);

  const stopCamera = useCallback(() => {
    if (scanTimer.current !== null) {
      window.clearTimeout(scanTimer.current);
      scanTimer.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream !== null) for (const track of stream.getTracks()) track.stop();
    if (videoRef.current !== null) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') stopCamera();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [stopCamera]);

  // The object URL of the cropped picture is ours to revoke; the previous one always goes.
  const rememberThumbnail = useCallback((url: string | null) => {
    if (thumbnailRef.current !== null && thumbnailRef.current.startsWith('blob:')) {
      URL.revokeObjectURL(thumbnailRef.current);
    }
    thumbnailRef.current = url;
    setThumbnail(url);
  }, []);

  const fail = useCallback((kind: FailureKind) => {
    setError(KIND_LABEL[kind]);
    setRetryable(kind !== 'disabled' && kind !== 'no_index' && kind !== 'invalid');
    setPhase((current) => (current === 'searching' ? 'choose' : current));
  }, []);

  /** Runs the search (or the similar search) and moves to the results phase. */
  const run = useCallback(
    async (
      input: { blob?: Blob; productId?: string; imageId?: string },
      nextSort = sort,
      nextPage = 1,
    ) => {
      setPhase('searching');
      setError(null);
      setPage(nextPage);
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        fail('offline');
        return;
      }
      const params = new URLSearchParams({
        sort: nextSort,
        page: String(nextPage),
        pageSize: String(PAGE_SIZE),
      });
      try {
        const response =
          input.blob !== undefined
            ? await fetch(`/api/visual-search?${params}`, {
                method: 'POST',
                body: formWith(input.blob),
              })
            : await fetch(`/api/visual-search/similar?${params}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  productId: input.productId,
                  imageId: input.imageId ?? null,
                }),
              });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
            message?: string;
          };
          const retryAfter = Number(response.headers.get('Retry-After') ?? '');
          setError(
            messageFor(
              response.status,
              body.error,
              Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter) : null,
            ),
          );
          setRetryable(response.status !== 400 && response.status !== 413);
          setPhase('choose');
          return;
        }
        const answer = (await response.json()) as ImageSearchResponse;
        setResult(answer);
        setSort(answer.sort);
        setPage(answer.page);
        setSource(
          input.productId === undefined
            ? null
            : {
                productId: input.productId,
                ...(input.imageId === undefined ? {} : { imageId: input.imageId }),
              },
        );
        setPhase('results');
      } catch {
        fail('offline');
      }
    },
    [fail, sort],
  );

  // A "Find similar" visit (or a reload of one) searches as soon as the page is ready.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || initialProductId === undefined) return;
    startedRef.current = true;
    void run({ productId: initialProductId, imageId: initialImageId });
  }, [initialImageId, initialProductId, run]);

  const openCamera = useCallback(async () => {
    setError(null);
    setMode(scanSupported ? 'scan' : 'photo');
    setPhase('camera');
    let request: Promise<MediaStream> | null = null;
    try {
      if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
        throw new DOMException('No camera in this browser', 'NotSupportedError');
      }
      request = navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 1280 },
        },
        audio: false,
      });
      const started = await withTimeout(request, CAMERA_START_TIMEOUT_MS);
      streamRef.current = started;
      if (videoRef.current !== null) {
        videoRef.current.srcObject = started;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch (cause) {
      const name = cause instanceof DOMException ? cause.name : '';
      // A camera that arrives after we gave up must not keep the light on.
      void request
        ?.then((late) => {
          if (late !== streamRef.current) for (const track of late.getTracks()) track.stop();
        })
        .catch(() => undefined);
      stopCamera();
      setPhase('choose');
      fail(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'camera_denied'
          : name === 'TimeoutError'
            ? 'camera_slow'
            : 'camera_unavailable',
      );
    }
  }, [fail, scanSupported, stopCamera]);

  // The page IS the camera: open it as soon as the page mounts, the way the app does. If the
  // browser refuses (no device, blocked permission), the fallback below offers a file instead.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || initialProductId !== undefined) return;
    autoOpened.current = true;
    void openCamera();
  }, [initialProductId, openCamera]);

  /** Resolves a decoded code through the API and navigates to the product or the search. */
  const followCode = useCallback(
    async (value: string) => {
      try {
        const response = await fetch('/api/scan/resolve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value }),
        });
        if (!response.ok) throw new Error('resolve failed');
        const answer = (await response.json()) as ScanResolveResponse;
        if (answer.kind === 'product' && answer.product !== null) {
          router.push(`/products/${answer.product.slug}`);
          return;
        }
        if (answer.kind === 'search' && answer.query !== null) {
          router.push(`/search?q=${encodeURIComponent(answer.query)}`);
          return;
        }
        setError(
          'That code is not one of our product labels. Try taking a photo of the product instead.',
        );
        setPhase('choose');
      } catch {
        setError('The code could not be checked. Check your connection and try again.');
        setPhase('choose');
      }
    },
    [router],
  );

  /** Decodes a QR code or barcode from the live preview and follows it. */
  const scanFrame = useCallback(async () => {
    const Detector = barcodeDetector();
    const video = videoRef.current;
    if (Detector === null || video === null || video.readyState < 2) return;
    const detector = new Detector({ formats: SCAN_FORMATS });
    try {
      const codes = await detector.detect(video);
      const value = codes[0]?.rawValue?.trim();
      if (value !== undefined && value !== '') {
        stopCamera();
        await followCode(value);
        return;
      }
    } catch {
      // A frame that cannot be read is normal; the next one may.
    }
  }, [followCode, stopCamera]);

  // The scan loop: a still frame every 400 ms, which is fast enough to feel live and cheap
  // enough not to heat the phone.
  useEffect(() => {
    if (phase !== 'camera' || mode !== 'scan') return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await scanFrame();
      if (!cancelled) scanTimer.current = window.setTimeout(() => void tick(), 400);
    };
    void tick();
    return () => {
      cancelled = true;
      if (scanTimer.current !== null) window.clearTimeout(scanTimer.current);
      scanTimer.current = null;
    };
  }, [mode, phase, scanFrame]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (video === null || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const blob = await toBlob(canvas);
    stopCamera();
    if (blob === null) {
      fail('invalid');
      return;
    }
    setCaptured({ blob, url: URL.createObjectURL(blob) });
    setPhase('crop');
  }, [fail, stopCamera]);

  const chooseFile = useCallback(
    (file: File | undefined) => {
      if (file === undefined) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        fail('invalid');
        return;
      }
      setCaptured({ blob: file, url: URL.createObjectURL(file) });
      setPhase('crop');
    },
    [fail],
  );

  /** Confirms the crop: barcode first, then the visual search with the prepared picture. */
  const confirmCrop = useCallback(
    async (blob: Blob) => {
      rememberThumbnail(URL.createObjectURL(blob));
      const Detector = barcodeDetector();
      if (Detector !== null) {
        try {
          const bitmap = await createImageBitmap(blob);
          const codes = await new Detector({ formats: SCAN_FORMATS }).detect(bitmap);
          bitmap.close();
          const value = codes[0]?.rawValue?.trim();
          if (value !== undefined && value !== '') {
            stopCamera();
            await followCode(value);
            return;
          }
        } catch {
          // No readable code: carry on with the visual search.
        }
      }
      await run({ blob });
    },
    [followCode, rememberThumbnail, run, stopCamera],
  );

  const changeSort = useCallback(
    (next: ImageSearchSort) => {
      if (next === sort && result !== null) return;
      setSort(next);
      if (source !== null) void run({ ...source }, next, 1);
    },
    [result, run, sort, source],
  );

  /** The last cropped picture, kept so "next page" can replay the same search. */
  const lastBlob = useRef<Blob | null>(null);
  useEffect(() => {
    if (captured !== null) lastBlob.current = captured.blob;
  }, [captured]);

  const changePage = useCallback(
    (nextPage: number) => {
      if (result === null) return;
      if (source !== null) {
        void run({ ...source }, sort, nextPage);
        return;
      }
      // A photo search cannot be replayed without the picture, so the page keeps the last
      // cropped blob for exactly this: the same photo, the next page.
      if (lastBlob.current !== null) void run({ blob: lastBlob.current }, sort, nextPage);
    },
    [result, run, sort, source],
  );

  const startOver = useCallback(() => {
    setResult(null);
    setError(null);
    setCaptured(null);
    rememberThumbnail(null);
    void openCamera();
  }, [openCamera, rememberThumbnail]);

  return (
    <div className="grid gap-6">
      <VisualSearchHeader
        step={phase}
        thumbnail={thumbnail}
        title={source !== null ? (initialProductName ?? 'Similar products') : 'Search by photo'}
        onClose={() => router.push('/search')}
        onNew={startOver}
      />

      {error !== null ? (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-2xl border border-error/30 bg-error/5 p-4 text-sm text-foreground"
        >
          <Zap aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-error" />
          <div className="grid gap-2">
            <p>{error}</p>
            {retryable ? (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  if (source !== null) void run({ ...source }, sort, page);
                }}
                className="w-fit text-sm font-semibold text-link underline-offset-4 hover:underline"
              >
                Try again
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {phase === 'choose' ? (
        <section className="grid gap-4 rounded-3xl border border-border bg-surface p-5 sm:p-6">
          <div className="grid gap-1">
            <h2 className="text-lg font-semibold">Search with a photo</h2>
            <p className="text-sm text-muted-foreground">
              The camera could not start in this browser. Choose a picture of the product and we
              will look for matches.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={cn(buttonClasses({ variant: 'primary', size: 'lg' }), 'w-full')}
            >
              <ImagePlus aria-hidden="true" className="size-4.5" /> Choose a photo
            </button>
            <button
              type="button"
              onClick={() => void openCamera()}
              className={cn(buttonClasses({ variant: 'secondary', size: 'lg' }), 'w-full')}
            >
              <Camera aria-hidden="true" className="size-4.5" /> Try the camera again
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Your photo is used for this search only and is never saved.
          </p>
        </section>
      ) : null}

      {phase === 'camera' ? (
        <section className="grid gap-3 overflow-hidden rounded-3xl border border-border bg-brand-navy p-3 sm:p-4">
          <div className="flex gap-2">
            <ModeTab
              active={mode === 'scan'}
              onClick={() => setMode('scan')}
              icon={QrCode}
              disabled={!scanSupported}
            >
              Scan
            </ModeTab>
            <ModeTab active={mode === 'photo'} onClick={() => setMode('photo')} icon={Camera}>
              Photo
            </ModeTab>
          </div>
          <div className="relative overflow-hidden rounded-2xl bg-black">
            <video
              ref={videoRef}
              playsInline
              muted
              aria-label="Camera preview"
              className="aspect-square w-full object-cover"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 grid place-items-center"
            >
              <div className="relative size-2/3">
                <span className="absolute top-0 left-0 size-7 rounded-tl-xl border-t-[3px] border-l-[3px] border-white/90" />
                <span className="absolute top-0 right-0 size-7 rounded-tr-xl border-t-[3px] border-r-[3px] border-white/90" />
                <span className="absolute bottom-0 left-0 size-7 rounded-bl-xl border-b-[3px] border-l-[3px] border-white/90" />
                <span className="absolute right-0 bottom-0 size-7 rounded-br-xl border-r-[3px] border-b-[3px] border-white/90" />
                {mode === 'scan' ? (
                  <span className="absolute inset-0 rounded-xl shadow-[0_0_0_9999px_rgba(15,23,42,0.35)]" />
                ) : null}
              </div>
            </div>
          </div>
          {mode === 'scan' && !scanSupported ? (
            <p className="rounded-xl bg-white/10 p-3 text-sm text-white">
              This browser cannot scan codes. Use Photo instead, or type the product code in search.
            </p>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                stopCamera();
                setPhase('choose');
              }}
              className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void capture()}
              className="grid size-16 place-items-center rounded-full bg-white ring-4 ring-white/30"
              aria-label={mode === 'scan' ? 'Scan this frame' : 'Take the photo'}
            >
              <span className="block size-12 rounded-full bg-primary-action" />
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white"
            >
              Gallery
            </button>
          </div>
        </section>
      ) : null}

      {/* One file input for the whole page: the fallback, the camera's Gallery button and the
          crop's "choose another" all open the same picker. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          void chooseFile(event.target.files?.[0]);
          // Clear the value so choosing the same file twice still fires a change.
          event.target.value = '';
        }}
      />

      {phase === 'crop' && captured !== null ? (
        <CropStep
          imageUrl={captured.url}
          onCancel={() => {
            setCaptured(null);
            void openCamera();
          }}
          onConfirm={(blob) => void confirmCrop(blob)}
        />
      ) : null}

      {phase === 'searching' ? <ResultsSkeleton thumbnail={thumbnail} /> : null}

      {phase === 'results' && result !== null ? (
        <Results
          result={result}
          sort={sort}
          onSort={changeSort}
          onPage={changePage}
          onNew={startOver}
          searchId={result.searchId}
          seeded={source?.productId !== undefined}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function formWith(blob: Blob): FormData {
  const form = new FormData();
  form.append('file', blob, 'query.jpg');
  return form;
}

async function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82));
}

function VisualSearchHeader({
  step,
  thumbnail,
  title,
  onClose,
  onNew,
}: {
  step: Phase;
  thumbnail: string | null;
  title: string;
  onClose: () => void;
  onNew: () => void;
}) {
  return (
    <header className="flex items-center gap-3">
      {thumbnail !== null ? (
        // eslint-disable-next-line @next/next/no-img-element -- a local object URL from the crop
        <img
          src={thumbnail}
          alt=""
          className="size-12 rounded-xl object-cover ring-1 ring-border ring-inset"
        />
      ) : (
        <span className="grid size-12 place-items-center rounded-xl bg-primary-action/10 text-primary-action">
          <Sparkles aria-hidden="true" className="size-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold" title={title}>
          {title}
        </h1>
        <p className="text-xs text-muted-foreground">
          {step === 'results' ? 'Match the photo to a product' : 'Image search'}
        </p>
      </div>
      {step !== 'choose' ? (
        <button
          type="button"
          onClick={onNew}
          aria-label="Start a new search"
          className={cn(buttonClasses({ variant: 'secondary', size: 'sm' }), 'shrink-0')}
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">New photo</span>
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close image search"
        className="grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-surface-muted hover:text-foreground"
      >
        <X aria-hidden="true" className="size-5" />
      </button>
    </header>
  );
}

function ModeTab({
  active,
  onClick,
  icon: Icon,
  disabled = false,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof QrCode;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={disabled}
      className={cn(
        'flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
        active ? 'bg-white text-brand-navy' : 'bg-white/10 text-white hover:bg-white/20',
        disabled && 'opacity-50',
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
      {children}
    </button>
  );
}

/**
 * Crop before searching. The picture is fitted into the frame, and a square window over it is
 * moved by dragging and resized with the zoom slider; on touch the same gestures work through
 * pointer events (dragging the window, pinching is not required to use it).
 */
function CropStep({
  imageUrl,
  onCancel,
  onConfirm,
}: {
  imageUrl: string;
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);

  /** The crop window in fractions of the picture (0..1), derived from zoom and offset. */
  const size = 1 / zoom;
  const half = size / 2;
  const center = {
    x: Math.min(1 - half, Math.max(half, 0.5 + offset.x * (1 - size))),
    y: Math.min(1 - half, Math.max(half, 0.5 + offset.y * (1 - size))),
  };

  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const confirm = async () => {
    const image = imageRef.current;
    const frame = frameRef.current;
    if (image === null || frame === null || busy) return;
    setBusy(true);
    try {
      // The window in displayed pixels, mapped back onto the natural picture.
      const rect = frame.getBoundingClientRect();
      const scale = Math.max(image.naturalWidth / rect.width, image.naturalHeight / rect.height);
      const side = Math.min(rect.width, rect.height) * size;
      const left = rect.width * (center.x - half);
      const top = rect.height * (center.y - half);
      const naturalSide = side * scale;
      const sourceX = Math.max(0, left * scale + (image.naturalWidth - rect.width * scale) / 2);
      const sourceY = Math.max(0, top * scale + (image.naturalHeight - rect.height * scale) / 2);
      const output = Math.round(Math.min(1024, naturalSide));
      const canvas = document.createElement('canvas');
      canvas.width = output;
      canvas.height = output;
      const context = canvas.getContext('2d');
      if (context === null) return;
      context.drawImage(image, sourceX, sourceY, naturalSide, naturalSide, 0, 0, output, output);
      const blob = await toBlob(canvas);
      if (blob !== null) onConfirm(blob);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="grid gap-4 rounded-3xl border border-border bg-surface p-4 sm:p-6">
      <div className="grid gap-1">
        <h2 className="text-base font-semibold">Crop to the product</h2>
        <p className="text-sm text-muted-foreground">
          Drag the frame over the product, and zoom in until it fills it. A closer crop finds better
          matches.
        </p>
      </div>
      <div
        ref={frameRef}
        className="relative mx-auto max-h-[60vh] w-full max-w-md touch-none overflow-hidden rounded-2xl bg-brand-navy select-none"
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          const frame = frameRef.current;
          if (start === null || frame === null) return;
          const rect = frame.getBoundingClientRect();
          setOffset({
            x: clamp(start.ox + (event.clientX - start.x) / (rect.width * (1 - size)), -1, 1),
            y: clamp(start.oy + (event.clientY - start.y) / (rect.height * (1 - size)), -1, 1),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- an object URL from the camera */}
        <img
          ref={imageRef}
          src={imageUrl}
          alt="Photo to search with"
          className="pointer-events-none block h-full w-full object-contain"
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div
            className="absolute rounded-xl border-2 border-white shadow-[0_0_0_9999px_rgba(15,23,42,0.55)]"
            style={{
              left: `${(center.x - half) * 100}%`,
              top: `${(center.y - half) * 100}%`,
              width: `${size * 100}%`,
              height: `${size * 100}%`,
            }}
          />
        </div>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <ZoomIn aria-hidden="true" className="size-4 text-muted-foreground" />
        <input
          type="range"
          min={1}
          max={3}
          step={0.05}
          value={zoom}
          onChange={(event) => setZoom(Number(event.target.value))}
          className="flex-1 accent-primary-action"
          aria-label="Crop zoom"
        />
      </label>
      <div className="flex flex-wrap justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            setZoom(1);
            setOffset({ x: 0, y: 0 });
          }}
          className={cn(buttonClasses({ variant: 'ghost', size: 'sm' }))}
        >
          Reset
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className={cn(buttonClasses({ variant: 'secondary', size: 'md' }))}
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy}
            className={cn(buttonClasses({ variant: 'primary', size: 'md' }))}
          >
            {busy ? (
              <Loader2
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
            ) : (
              <Search aria-hidden="true" className="size-4" />
            )}
            Search with this
          </button>
        </div>
      </div>
    </section>
  );
}

function ResultsSkeleton({ thumbnail }: { thumbnail: string | null }) {
  return (
    <section aria-busy="true" className="grid gap-4">
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
        Looking for products that look like {thumbnail === null ? 'your photo' : 'this'}…
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="grid gap-2">
            <Skeleton className="aspect-square rounded-2xl" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        ))}
      </div>
    </section>
  );
}

function Results({
  result,
  sort,
  onSort,
  onPage,
  onNew,
  searchId,
  seeded,
}: {
  result: ImageSearchResponse;
  sort: ImageSearchSort;
  onSort: (sort: ImageSearchSort) => void;
  onPage: (page: number) => void;
  onNew: () => void;
  searchId: string | null;
  /** True when a product's own picture seeded the search ("Find similar"). */
  seeded: boolean;
}) {
  const priceAscending = sort === 'price_asc';
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" role="status">
          {result.outcome === 'results'
            ? result.total === 1
              ? '1 product looks like this'
              : `${result.total} products look like this`
            : seeded
              ? 'No similar products'
              : 'No matches'}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSort('best_match')}
            aria-pressed={sort === 'best_match'}
            className={cn(
              buttonClasses({
                variant: sort === 'best_match' ? 'primary' : 'secondary',
                size: 'sm',
              }),
            )}
          >
            <Sparkles aria-hidden="true" className="size-4" /> Best match
          </button>
          <button
            type="button"
            onClick={() => onSort(priceAscending ? 'price_desc' : 'price_asc')}
            aria-pressed={sort !== 'best_match'}
            className={cn(
              buttonClasses({
                variant: sort !== 'best_match' ? 'primary' : 'secondary',
                size: 'sm',
              }),
            )}
          >
            {priceAscending ? (
              <ArrowUpWideNarrow aria-hidden="true" className="size-4" />
            ) : (
              <ArrowDownWideNarrow aria-hidden="true" className="size-4" />
            )}
            Price
          </button>
        </div>
      </div>

      {result.items.length === 0 ? (
        <div className="grid justify-items-center gap-3 rounded-3xl border border-dashed border-border bg-surface p-8 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-primary-action/10 text-primary-action">
            <Search aria-hidden="true" className="size-6" />
          </span>
          <h2 className="text-lg font-semibold">
            {seeded ? 'Nothing similar yet' : 'No similar products found'}
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {seeded
              ? 'No other product in the catalogue looks like this one yet. Browse the collection, or try a photo of something else.'
              : 'Try again with the product filling more of the frame, a plain background, or better light. Cropping closer to the product helps most.'}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {seeded ? (
              <>
                <Link
                  href="/search"
                  className={cn(buttonClasses({ variant: 'primary', size: 'md' }))}
                >
                  Browse all products
                </Link>
                <button
                  type="button"
                  onClick={onNew}
                  className={cn(buttonClasses({ variant: 'secondary', size: 'md' }))}
                >
                  <Camera aria-hidden="true" className="size-4" /> Search with a photo
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onNew}
                className={cn(buttonClasses({ variant: 'primary', size: 'md' }))}
              >
                <Camera aria-hidden="true" className="size-4" /> Take another photo
              </button>
            )}
          </div>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          {result.items.map((item) => (
            <li key={item.product.id}>
              <ProductLink searchId={searchId} productId={item.product.id}>
                <ProductCard product={item.product} headingLevel="h3" />
              </ProductLink>
              <p className="mt-1 text-xs text-muted-foreground">
                {Math.round(item.similarity * 100)}% visual match
              </p>
            </li>
          ))}
        </ul>
      )}

      {result.totalPages > 1 ? (
        <nav aria-label="Result pages" className="flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={result.page <= 1}
            onClick={() => onPage(result.page - 1)}
            className={cn(
              buttonClasses({ variant: 'secondary', size: 'sm' }),
              result.page <= 1 && 'opacity-50',
            )}
          >
            Previous
          </button>
          <span className="text-sm text-muted-foreground">
            Page {result.page} of {result.totalPages}
          </span>
          <button
            type="button"
            disabled={result.page >= result.totalPages}
            onClick={() => onPage(result.page + 1)}
            className={cn(
              buttonClasses({ variant: 'secondary', size: 'sm' }),
              result.page >= result.totalPages && 'opacity-50',
            )}
          >
            Next
          </button>
        </nav>
      ) : null}
    </section>
  );
}

/** Records the click before the card's own link navigates. */
function ProductLink({
  searchId,
  productId,
  children,
}: {
  searchId: string | null;
  productId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={() => {
        if (searchId === null) return;
        void fetch('/api/visual-search/click', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ searchId, productId }),
          keepalive: true,
        }).catch(() => undefined);
      }}
    >
      {children}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
