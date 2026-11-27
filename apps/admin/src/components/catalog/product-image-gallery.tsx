'use client';

import {
  MAX_PRODUCT_IMAGES,
  PRODUCT_IMAGE_CONTENT_TYPES,
  type ProductImage,
} from '@nilzora/contracts';
import {
  Button,
  cn,
  formatBytes,
  Input,
  SelectedImagePreview,
  type SendOptions,
} from '@nilzora/ui';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Crop,
  GripVertical,
  ImagePlus,
  Images,
  LoaderCircle,
  RotateCw,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { startTransition, useActionState, useId, useRef, useState, type DragEvent } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { Chip } from '@/components/admin-kit/chip';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { useInteractive } from '@/components/admin-kit/use-interactive';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import {
  deleteProductImageAction,
  moveProductImageAction,
  reorderProductImagesAction,
  updateProductImageAltAction,
  uploadProductImageAction,
} from '@/lib/image-actions';
import { guidanceLine, uploadGuidance } from '@/lib/upload-guidance';
import { uploadEndpoint } from '@/lib/upload-routes';
import { EmptyPanel } from './catalog-ui';
import { CropDialog } from './crop-dialog';
import {
  useUploadQueue,
  type QueueItem,
  type QueueRejection,
  type UploadQueue,
} from './upload-queue';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * The product's pictures. The page passes `editable` only for an account with
 * products.update on a product whose content is not locked; every action is authorised
 * again by the API. Pictures are plain <img> elements: they come from the media origin,
 * which is not known to the app's build.
 */

const ACCEPT = PRODUCT_IMAGE_CONTENT_TYPES.join(',');

/** The shared product-picture guidance, so the numbers match every other upload slot. */
const PRODUCT_IMAGE_GUIDANCE = guidanceLine(uploadGuidance('product-image'));

function altOf(image: ProductImage, index: number): string {
  return image.alt?.trim() || `Product image ${String(index + 1)}`;
}

/** The order with `id` moved to `target`. */
export function moveTo(order: readonly string[], id: string, target: number): string[] {
  const rest = order.filter((candidate) => candidate !== id);
  const index = Math.max(0, Math.min(rest.length, target));
  return [...rest.slice(0, index), id, ...rest.slice(index)];
}

// ---------------------------------------------------------------------------
// The pictures
// ---------------------------------------------------------------------------

interface CardProps {
  image: ProductImage;
  index: number;
  count: number;
  /** Every image id of the product, in the order this page shows them. */
  order: string;
  productId: string;
  csrf: CsrfInput;
  editable: boolean;
  draggable: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onDragStart: (id: string) => void;
  onDragEnter: (index: number) => void;
  onDragEnd: () => void;
  onDrop: (index: number) => void;
}

function ImageCard({
  image,
  index,
  count,
  order,
  productId,
  csrf,
  editable,
  draggable,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
}: CardProps) {
  const tx = useTx();
  const [altState, altAction, altPending] = useActionState(updateProductImageAltAction, IDLE_STATE);
  const [moveState, moveAction, movePending] = useActionState(moveProductImageAction, IDLE_STATE);
  const [deleteState, deleteAction] = useActionState(deleteProductImageAction, IDLE_STATE);
  const altError =
    altState.fieldErrors?.alt ?? (altState.status === 'error' ? altState.message : undefined);
  const altId = `alt-${image.id}`;
  const number = index + 1;
  const cover = index === 0;

  return (
    <li
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', image.id);
        onDragStart(image.id);
      }}
      onDragEnter={() => onDragEnter(index)}
      onDragOver={(event) => {
        if (draggable) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(index);
      }}
      onDragEnd={onDragEnd}
      className={cn(
        'nz-panel-strong grid content-start gap-3 rounded-2xl border p-3 transition-[opacity,box-shadow]',
        dragging && 'opacity-50',
        dropTarget && 'ring-2 ring-info-ink',
      )}
    >
      <div className="relative aspect-4/3 overflow-hidden rounded-xl bg-neutral-soft">
        {/* eslint-disable-next-line @next/next/no-img-element -- served from the media origin, unknown at build time */}
        <img
          src={image.thumbUrl}
          alt={altOf(image, index)}
          width={image.width}
          height={image.height}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-contain"
        />
        <Chip tone={cover ? 'primary' : 'neutral'} className="absolute top-2 left-2">
          {cover ? (
            <>
              <Star aria-hidden="true" className="size-3" strokeWidth={1.75} />
              Cover
            </>
          ) : (
            `Image ${String(number)}`
          )}
        </Chip>
        {draggable ? (
          <span
            aria-hidden="true"
            className="nz-glass absolute top-2 right-2 grid size-8 cursor-grab place-items-center rounded-lg border text-muted-foreground"
            title={tx('Drag to reorder')}
          >
            <GripVertical className="size-4" strokeWidth={1.75} />
          </span>
        ) : null}
      </div>

      {editable ? (
        <>
          <form action={altAction} className="grid gap-1.5">
            <CsrfField csrf={csrf} />
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="imageId" value={image.id} />
            <label htmlFor={altId} className="text-xs font-medium text-muted-foreground">
              <AutoText>Description</AutoText>
            </label>
            <div className="flex gap-2">
              <Input
                id={altId}
                name="alt"
                maxLength={160}
                defaultValue={altState.values?.alt ?? image.alt ?? ''}
                placeholder={tx('What the picture shows')}
                aria-invalid={altError ? true : undefined}
                aria-describedby={altError ? `${altId}-error` : undefined}
                className="h-9 min-w-0 flex-1 rounded-xl max-sm:h-11"
              />
              <Button
                type="submit"
                variant="outline"
                size="sm"
                loading={altPending}
                className="h-9 shrink-0 rounded-xl max-sm:h-11"
              >
                {altPending ? null : <Check aria-hidden="true" strokeWidth={1.75} />}
                Save <span className="sr-only">description</span>
              </Button>
            </div>
            {altError ? (
              <p id={`${altId}-error`} className="text-xs font-medium text-danger-ink">
                {altError}
              </p>
            ) : null}
          </form>

          <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
            <form action={moveAction} className="flex flex-wrap gap-2">
              <CsrfField csrf={csrf} />
              <input type="hidden" name="productId" value={productId} />
              <input type="hidden" name="imageId" value={image.id} />
              <input type="hidden" name="order" value={order} />
              <Button
                type="submit"
                name="direction"
                value="earlier"
                variant="outline"
                size="sm"
                disabled={cover || movePending}
                aria-label={`Move image ${String(number)} earlier`}
                className="rounded-xl max-sm:size-11"
              >
                <ChevronLeft aria-hidden="true" strokeWidth={1.75} />
              </Button>
              <Button
                type="submit"
                name="direction"
                value="later"
                variant="outline"
                size="sm"
                disabled={index === count - 1 || movePending}
                aria-label={`Move image ${String(number)} later`}
                className="rounded-xl max-sm:size-11"
              >
                <ChevronRight aria-hidden="true" strokeWidth={1.75} />
              </Button>
              {cover ? null : (
                <Button
                  type="submit"
                  name="direction"
                  value="first"
                  variant="ghost"
                  size="sm"
                  disabled={movePending}
                  className="rounded-xl max-sm:min-h-11"
                >
                  <Star aria-hidden="true" strokeWidth={1.75} />
                  Set as cover<span className="sr-only">: image {number}</span>
                </Button>
              )}
            </form>
            <ConfirmForm
              action={deleteAction}
              csrf={csrf}
              align="end"
              className="ml-auto"
              trigger={
                <>
                  <Trash2 aria-hidden="true" strokeWidth={1.75} />
                  Remove
                </>
              }
              title={`Remove image ${String(number)}?`}
              description={tx(
                'The picture is deleted from this product. Changed images need a new review before the product can be published.',
              )}
              confirmLabel={tx('Yes, remove it')}
              hiddenFields={{ productId, imageId: image.id }}
              error={deleteState.status === 'error' ? deleteState.message : undefined}
            />
          </div>
          {moveState.status === 'error' ? (
            <ActionFeedback state={moveState} inline className="-mt-1" />
          ) : null}
        </>
      ) : null}
    </li>
  );
}

/**
 * The pictures in order, with the controls for each when the account may change them.
 * With JavaScript they can be dragged into a new order; the earlier/later buttons are the
 * keyboard (and no-JavaScript) way to do the same.
 */
export function ProductImageList({
  productId,
  images,
  csrf,
  editable,
}: {
  productId: string;
  images: readonly ProductImage[];
  csrf: CsrfInput;
  editable: boolean;
}) {
  const tx = useTx();
  const interactive = useInteractive();
  const ids = images.map((image) => image.id);
  const order = ids.join(',');
  const [reorderState, reorder, reordering] = useActionState(
    reorderProductImagesAction,
    IDLE_STATE,
  );
  const [dragged, setDragged] = useState<string | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const canDrag = editable && interactive && images.length > 1 && !reordering;

  const drop = (index: number) => {
    const id = dragged;
    setDragged(null);
    setTarget(null);
    if (!id) return;
    const next = moveTo(ids, id, index);
    if (next.join(',') === order) return;
    const data = new FormData();
    data.set(csrf.name, csrf.token);
    data.set('productId', productId);
    data.set('order', order);
    data.set('next', next.join(','));
    startTransition(() => reorder(data));
  };

  return (
    <div className="grid gap-3">
      {canDrag ? (
        <p className="text-xs text-muted-foreground">
          <AutoText>
            Drag pictures to reorder them, or use the arrow buttons. The cover is shown in listings.
          </AutoText>
        </p>
      ) : null}
      <ul
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        aria-label={tx('Product images')}
        aria-busy={reordering || undefined}
        onDragOver={(event: DragEvent) => {
          if (dragged) event.preventDefault();
        }}
      >
        {images.map((image, index) => (
          <ImageCard
            key={`${image.id}-${String(image.position)}-${image.alt ?? ''}`}
            image={image}
            index={index}
            count={images.length}
            order={order}
            productId={productId}
            csrf={csrf}
            editable={editable}
            draggable={canDrag}
            dragging={dragged === image.id}
            dropTarget={target === index && dragged !== null && dragged !== image.id}
            onDragStart={setDragged}
            onDragEnter={setTarget}
            onDragEnd={() => {
              setDragged(null);
              setTarget(null);
            }}
            onDrop={drop}
          />
        ))}
      </ul>
      {reordering ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
          <AutoText>Saving the new order…</AutoText>
        </p>
      ) : reorderState.status === 'error' ? (
        <ActionFeedback state={reorderState} inline />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Adding pictures
// ---------------------------------------------------------------------------

function QueueRow({
  item,
  queue,
  disabled,
  onCrop,
}: {
  item: QueueItem;
  queue: UploadQueue;
  disabled: boolean;
  onCrop: (item: QueueItem) => void;
}) {
  const tx = useTx();
  const altId = useId();
  const sending = item.status === 'transferring' || item.status === 'processing';
  return (
    <li className="nz-panel-strong grid gap-3 rounded-2xl border p-3 sm:grid-cols-[4rem_minmax(0,1fr)] sm:items-start">
      <SelectedImagePreview file={item.file} className="size-16 rounded-xl" />
      <div className="grid min-w-0 gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            className="min-w-0 truncate text-sm font-medium text-foreground"
            title={item.file.name}
          >
            {item.file.name}
          </p>
          <span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
            {item.cropped ? (
              <Chip tone="violet">
                <AutoText>Cropped</AutoText>
              </Chip>
            ) : null}
            {formatBytes(item.file.size)}
          </span>
        </div>

        {item.status === 'ready' ? (
          <div className="grid gap-2">
            <label htmlFor={altId} className="sr-only">
              Description of {item.file.name}
            </label>
            <Input
              id={altId}
              value={item.alt}
              maxLength={160}
              placeholder={tx('Description (optional)')}
              disabled={disabled}
              onChange={(event) => queue.update(item.key, { alt: event.currentTarget.value })}
              className="h-9 rounded-xl max-sm:h-11"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onCrop(item)}
                className="rounded-xl max-sm:min-h-11"
              >
                <Crop aria-hidden="true" strokeWidth={1.75} />
                {item.cropped ? 'Change crop' : 'Crop'}
                <span className="sr-only">: {item.file.name}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => queue.remove(item.key)}
                className="rounded-xl max-sm:min-h-11"
              >
                <X aria-hidden="true" strokeWidth={1.75} />
                Remove from queue<span className="sr-only">: {item.file.name}</span>
              </Button>
            </div>
          </div>
        ) : null}

        {sending ? (
          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
              <span>
                {item.status === 'processing'
                  ? 'Checking and saving the picture…'
                  : `Uploading… ${String(item.percent)}%`}
              </span>
              <span className="tabular-nums">
                {formatBytes(item.loaded)} / {formatBytes(item.total)}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label={`Uploading ${item.file.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={item.percent}
              className="h-2 overflow-hidden rounded-full bg-chart-track"
            >
              <div
                className={cn(
                  'h-full rounded-full bg-chart-1 transition-[width] duration-150 motion-reduce:transition-none',
                  item.status === 'processing' && 'nz-shimmer',
                )}
                style={{ width: `${String(item.percent)}%` }}
              />
            </div>
            {item.status === 'transferring' ? (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={queue.cancel}
                  className="rounded-xl max-sm:min-h-11"
                >
                  <AutoText>Cancel upload</AutoText>
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {item.status === 'done' ? (
          <p
            role="status"
            className="flex items-center gap-1.5 text-xs font-medium text-success-ink"
          >
            <Check aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
            {item.message ?? 'Uploaded.'}
          </p>
        ) : null}

        {item.status === 'error' ? (
          <div className="grid gap-2">
            <p
              role="alert"
              className="flex items-start gap-1.5 text-xs font-medium text-danger-ink"
            >
              <CircleAlert
                aria-hidden="true"
                className="mt-px size-3.5 shrink-0"
                strokeWidth={1.75}
              />
              {item.message}
            </p>
            <div className="flex flex-wrap gap-2">
              {item.canRetry ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() => queue.retry(item.key)}
                  className="rounded-xl max-sm:min-h-11"
                >
                  <RotateCw aria-hidden="true" strokeWidth={1.75} />
                  Try again<span className="sr-only">: {item.file.name}</span>
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => queue.remove(item.key)}
                className="rounded-xl max-sm:min-h-11"
              >
                <X aria-hidden="true" strokeWidth={1.75} />
                Remove from queue<span className="sr-only">: {item.file.name}</span>
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function Rejections({ rejections }: { rejections: readonly QueueRejection[] }) {
  if (rejections.length === 0) return null;
  return (
    <ul role="alert" className="grid gap-1 text-sm">
      {rejections.map((rejection, index) => (
        <li
          key={`${rejection.name}-${String(index)}`}
          className="flex flex-wrap gap-x-1.5 text-danger-ink"
        >
          <span className="font-medium">{rejection.name}:</span>
          <span>
            <AutoText value={rejection.message} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Adds pictures: drop files on the zone or pick several at once, check each one here
 * (type and size, the same rules the server applies), crop any of them, then upload them
 * one after another with real progress. Without JavaScript the same zone is an ordinary
 * file field that uploads one picture through the Server Action.
 */
export function ProductImageUploader({
  productId,
  csrf,
  imageCount,
  createRequest,
}: {
  productId: string;
  csrf: CsrfInput;
  imageCount: number;
  /** For tests; the browser's XMLHttpRequest by default. */
  createRequest?: SendOptions['createRequest'];
}) {
  const tx = useTx();
  const interactive = useInteractive();
  const router = useRouter();
  const [state, action, pending] = useActionState(uploadProductImageAction, IDLE_STATE);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rejections, setRejections] = useState<QueueRejection[]>([]);
  const [over, setOver] = useState(false);
  const [cropping, setCropping] = useState<QueueItem | null>(null);
  const free = Math.max(0, MAX_PRODUCT_IMAGES - imageCount);
  const queue = useUploadQueue({
    endpoint: uploadEndpoint('product-image'),
    capacity: free,
    createRequest,
    fields: () => ({ [csrf.name]: csrf.token, productId }),
    fileFields: (item): Record<string, string> =>
      item.alt.trim() === '' ? {} : { alt: item.alt.trim() },
    // The page lists each picture as soon as the server confirmed it.
    onUploaded: () => router.refresh(),
    onFinished: () => {
      queue.clearDone();
      router.replace(`/admin/products/${productId}?notice=image-added` as Route);
    },
  });
  const waiting = queue.items.filter((item) => item.status === 'ready').length;
  const full = free === 0;
  const busy = pending || queue.busy;
  const inputId = `upload-${productId}`;
  const hintId = `${inputId}-hint`;

  const pick = (files: readonly File[]) => {
    setRejections(queue.add(files));
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setOver(false);
    if (full || busy) return;
    pick(Array.from(event.dataTransfer.files));
  };

  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!interactive) return;
        // With JavaScript the queue sends the files (with progress); the form never posts.
        event.preventDefault();
        void queue.start();
      }}
      className="grid gap-4"
    >
      <CsrfField csrf={csrf} />
      <input type="hidden" name="productId" value={productId} />
      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          event.preventDefault();
          if (!full && !busy) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          'grid cursor-pointer justify-items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors',
          over
            ? 'border-info-ink bg-info-soft'
            : 'border-hairline bg-neutral-soft/40 hover:bg-info-soft/50',
          (full || busy) && 'cursor-not-allowed opacity-60',
        )}
      >
        <span className="nz-float grid size-12 place-items-center rounded-full bg-info-soft text-info-ink ring-8 ring-info-soft">
          <ImagePlus aria-hidden="true" className="size-5" strokeWidth={1.75} />
        </span>
        <span className="text-sm font-semibold text-foreground">
          {interactive ? 'Drop pictures here or choose files' : 'Choose a picture'}
        </span>
        <span id={hintId} className="max-w-md text-xs text-muted-foreground">
          {PRODUCT_IMAGE_GUIDANCE}. {imageCount} of {MAX_PRODUCT_IMAGES} added; the first one is the
          cover shown in listings.
        </span>
        <span className="sr-only">
          <AutoText>Add images</AutoText>
        </span>
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        name="image"
        accept={ACCEPT}
        multiple={interactive}
        disabled={full || busy}
        aria-label={tx('Add images')}
        aria-describedby={hintId}
        onChange={(event) => {
          if (interactive) pick(Array.from(event.currentTarget.files ?? []));
        }}
        className={cn(
          interactive
            ? 'sr-only'
            : 'rounded-xl border border-input-border bg-surface p-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-neutral-soft file:px-3 file:py-1.5 file:text-sm file:font-semibold',
        )}
      />
      {interactive ? null : (
        <div className="grid gap-1.5">
          <label htmlFor={`${inputId}-alt`} className="text-sm font-medium text-foreground">
            <AutoText>Description</AutoText>
          </label>
          <Input
            id={`${inputId}-alt`}
            name="alt"
            maxLength={160}
            defaultValue={state.values?.alt}
            disabled={full}
          />
        </div>
      )}

      <Rejections rejections={rejections} />
      {state.status === 'error' ? <ActionFeedback state={state} /> : null}

      {queue.items.length > 0 ? (
        <ul aria-label={tx('Pictures to upload')} className="grid gap-3">
          {queue.items.map((item) => (
            <QueueRow
              key={item.key}
              item={item}
              queue={queue}
              disabled={queue.busy}
              onCrop={setCropping}
            />
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          loading={busy}
          disabled={full || (interactive && waiting === 0)}
          className="max-sm:min-h-11"
        >
          {busy ? null : <Upload aria-hidden="true" strokeWidth={1.75} />}
          {busy
            ? 'Uploading…'
            : interactive && waiting > 1
              ? `Upload ${String(waiting)} images`
              : 'Upload image'}
        </Button>
        {full ? (
          <p className="text-sm text-muted-foreground">
            <AutoText>
              This product has the most pictures it can keep. Remove one to add another.
            </AutoText>
          </p>
        ) : null}
      </div>

      {cropping ? (
        <CropDialog
          source={cropping.original}
          open
          onClose={() => setCropping(null)}
          onApply={(file, cropped) => {
            queue.update(cropping.key, { file, cropped, total: file.size });
            setCropping(null);
          }}
        />
      ) : null}
    </form>
  );
}

/** Pictures, upload and the empty state of a product's media section. */
export function ProductMedia({
  productId,
  images,
  csrf,
  editable,
}: {
  productId: string;
  images: readonly ProductImage[];
  csrf: CsrfInput;
  editable: boolean;
}) {
  const tx = useTx();
  return (
    <div className="grid gap-5">
      {images.length > 0 ? (
        <ProductImageList productId={productId} images={images} csrf={csrf} editable={editable} />
      ) : (
        <EmptyPanel
          icon={Images}
          title={tx('No images yet')}
          description={tx(
            'Shoppers see a placeholder until a picture is added. Products with several clear pictures sell better.',
          )}
          className="rounded-2xl border border-dashed border-hairline py-8"
        />
      )}
      {editable ? (
        <ProductImageUploader productId={productId} csrf={csrf} imageCount={images.length} />
      ) : null}
    </div>
  );
}
