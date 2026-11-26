'use client';

import {
  POPUP_AUDIENCE_LABELS,
  POPUP_AUDIENCES,
  POPUP_DELAY_SECONDS,
  POPUP_MAX_DELAY_SECONDS,
  POPUP_PLATFORM_LABELS,
  POPUP_PLATFORMS,
  POPUP_FREQUENCY_HINTS,
  POPUP_FREQUENCY_LABELS,
  POPUP_FREQUENCIES,
  POPUP_LIMITS,
  type AdminPopup,
  type PopupDisplayMode,
} from '@nilzora/contracts';
import { Button, Field, Input, NativeSelect, PromoPopupFrame, Textarea, cn } from '@nilzora/ui';
import { Copy, Eye, Monitor, Smartphone, Tablet, Trash2, Upload, X } from 'lucide-react';
import { useActionState, useState, type FormEvent, type ReactNode } from 'react';
import { ActionFeedback } from '@/components/admin-kit/action-feedback';
import type { ActionState } from '@/components/admin-kit/act';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import {
  deletePopupAction,
  duplicatePopupAction,
  removePopupArtworkAction,
  savePopupAction,
  setPopupActiveAction,
  uploadPopupArtworkAction,
} from '@/lib/popup-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/* Promotional popup forms: the copy and timing, the artwork, the live switch and removal. */
const IDLE: ActionState = { status: 'idle' };

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

/** "2026-11-01T09:00" in Bangladesh time, for a datetime-local field. */
function bdLocal(iso: string | null): string {
  if (!iso) return '';
  const shifted = new Date(new Date(iso).getTime() + 6 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The customer's popup, drawn at the size of one device. The same frame the storefront uses, so
 * what an admin approves here is what a customer sees — proportions included.
 */
/** The words the form is currently showing, so the previews follow typing before it is saved. */
export interface PopupDraft {
  displayMode: PopupDisplayMode;
  title: string;
  subtitle: string;
  description: string;
  buttonLabel: string;
  buttonHref: string;
  imageAlt: string;
}

function previewContent(popup: AdminPopup, draft: PopupDraft | null) {
  const text = (value: string | null): string | null => (value?.trim() ? value.trim() : null);
  const mode = draft?.displayMode ?? popup.displayMode;
  const words = mode === 'artwork';
  return {
    displayMode: mode,
    imageUrl: popup.imageUrl as string,
    imageWidth: popup.imageWidth ?? 1,
    imageHeight: popup.imageHeight ?? 1,
    isAnimated: popup.imageKind === 'animated',
    imageAlt: text(draft?.imageAlt ?? popup.imageAlt),
    title: words ? null : text(draft?.title ?? popup.title),
    subtitle: words ? null : text(draft?.subtitle ?? popup.subtitle),
    description: words ? null : text(draft?.description ?? popup.description),
    buttonLabel: words ? null : text(draft?.buttonLabel ?? popup.buttonLabel),
    buttonHref: text(draft?.buttonHref ?? popup.buttonHref),
  };
}

/**
 * The native app's version of the popup: a sheet on the phone screen's bottom edge, the picture
 * edge to edge with the words beneath it only when there are any. A drawing of the app's design,
 * not the app itself, so it shows layout and proportions rather than exact native rendering.
 */
export function PopupAppPreview({
  popup,
  draft = null,
}: {
  popup: AdminPopup;
  draft?: PopupDraft | null;
}) {
  if (popup.imageUrl === null) return null;
  const content = previewContent(popup, draft);
  const hasWords =
    content.title !== null ||
    content.subtitle !== null ||
    content.description !== null ||
    (content.buttonLabel !== null && content.buttonHref !== null);
  return (
    <div className="mx-auto w-full max-w-60 rounded-4xl border-4 border-foreground/80 bg-foreground/80 p-1.5 shadow-lg">
      <div className="relative flex aspect-9/16 items-end overflow-hidden rounded-3xl bg-surface-muted">
        <div aria-hidden="true" className="absolute inset-0 bg-foreground/45" />
        <div className="relative w-full overflow-hidden rounded-t-3xl bg-surface shadow-xl">
          <span
            aria-hidden="true"
            className="absolute top-1.5 left-1/2 z-10 h-1 w-8 -translate-x-1/2 rounded-full bg-foreground/25"
          />
          <span className="absolute top-2.5 right-2.5 z-10 grid size-7 place-items-center rounded-full bg-foreground/25 text-white backdrop-blur-sm">
            <X aria-hidden="true" className="size-3" strokeWidth={2.5} />
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element -- stored artwork from the media service */}
          <img
            src={content.imageUrl}
            alt={content.imageAlt ?? ''}
            width={content.imageWidth}
            height={content.imageHeight}
            className="block h-auto w-full"
          />
          {hasWords ? (
            <div className="grid gap-1 px-3 py-3 text-center">
              {content.title ? (
                <p className="text-sm font-semibold text-foreground">{content.title}</p>
              ) : null}
              {content.subtitle ? (
                <p className="text-xs font-medium text-muted-foreground">{content.subtitle}</p>
              ) : null}
              {content.description ? (
                <p className="text-xs text-muted-foreground">{content.description}</p>
              ) : null}
              {content.buttonLabel ? (
                <span className="mt-1 rounded-xl bg-primary-action px-3 py-2 text-xs font-semibold text-primary-action-foreground">
                  {content.buttonLabel}
                </span>
              ) : null}
            </div>
          ) : null}
          <div aria-hidden="true" className="h-3" />
        </div>
      </div>
    </div>
  );
}

/** Website and app previews side by side, following the form as it is edited. */
export function PopupPreviews({ popup, draft }: { popup: AdminPopup; draft: PopupDraft | null }) {
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="grid gap-2">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <AutoText>Website</AutoText>
        </p>
        <PopupPreview popup={popup} draft={draft} />
      </div>
      <div className="grid gap-2">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <AutoText>Android app</AutoText>
        </p>
        <PopupAppPreview popup={popup} draft={draft} />
      </div>
    </div>
  );
}

export function PopupPreview({
  popup,
  draft = null,
}: {
  popup: AdminPopup;
  draft?: PopupDraft | null;
}) {
  const tx = useTx();
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const widths = { desktop: 'max-w-2xl', tablet: 'max-w-md', mobile: 'max-w-[22rem]' } as const;
  if (popup.imageUrl === null) {
    return (
      <p className="rounded-xl border border-dashed border-hairline px-4 py-6 text-sm text-muted-foreground">
        <AutoText>Upload artwork to see the popup as a customer will.</AutoText>
      </p>
    );
  }
  return (
    <div className="grid gap-3">
      <div role="group" aria-label={tx('Preview size')} className="flex flex-wrap gap-1.5">
        {(
          [
            ['desktop', 'Desktop', Monitor],
            ['tablet', 'Tablet', Tablet],
            ['mobile', 'Phone', Smartphone],
          ] as const
        ).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            aria-pressed={device === value}
            onClick={() => setDevice(value)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold ring-1 transition-colors max-sm:min-h-11',
              device === value
                ? 'bg-info-soft text-info-ink ring-info-line'
                : 'text-muted-foreground ring-hairline hover:bg-surface-muted',
            )}
          >
            <Icon aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </div>
      <div className="grid place-items-center rounded-xl border border-hairline bg-surface-muted/50 p-4">
        <div className={cn('w-full', widths[device])}>
          <PromoPopupFrame
            content={previewContent(popup, draft)}
            promotionalLabel={`Preview of ${popup.internalName}`}
          />
        </div>
      </div>
    </div>
  );
}

/** Create or edit one popup: how it looks, what it says, when it appears. */
/** Where a click goes: a ready-made destination is turned into the store path the API stores. */
const SCREENS = [
  ['/', 'Home'],
  ['/categories', 'All categories'],
  ['/brands', 'All brands'],
  ['/vouchers', 'Vouchers'],
  ['/wishlist', 'Wishlist'],
  ['/account', 'My account'],
] as const;
type ClickKind = 'link' | 'product' | 'category' | 'screen';

function clickKindOf(href: string): ClickKind {
  if (href.startsWith('/products/')) return 'product';
  if (href.startsWith('/categories/') && href.length > '/categories/'.length) return 'category';
  if (SCREENS.some(([path]) => path === href)) return 'screen';
  return 'link';
}

export function PopupForm({
  popup,
  csrf,
  onDraft,
}: {
  popup?: AdminPopup;
  csrf: CsrfInput;
  /** Reports the words as they are typed, so the previews can follow. */
  onDraft?: (draft: PopupDraft) => void;
}) {
  const tx = useTx();
  const [state, action, pending] = useActionState(savePopupAction, IDLE);
  const errors = state.fieldErrors ?? {};
  const values = state.status === 'error' ? state.values : undefined;
  const id = popup?.id ?? 'new';
  const [mode, setMode] = useState<PopupDisplayMode>(
    (values?.displayMode ?? popup?.displayMode ?? 'template') as PopupDisplayMode,
  );

  const [href, setHref] = useState(values?.buttonHref ?? popup?.buttonHref ?? '');
  const [kind, setKind] = useState<ClickKind>(clickKindOf(href));
  const choose = (next: ClickKind) => {
    setKind(next);
    if (next === 'screen') setHref('/');
    if (next === 'product') setHref('/products/');
    if (next === 'category') setHref('/categories/');
  };
  const report = (event: FormEvent<HTMLFormElement>) => {
    if (onDraft === undefined) return;
    const data = new FormData(event.currentTarget);
    const read = (name: string): string => {
      const value = data.get(name);
      return typeof value === 'string' ? value : '';
    };
    onDraft({
      displayMode: (read('displayMode') || 'template') as PopupDisplayMode,
      title: read('title'),
      subtitle: read('subtitle'),
      description: read('description'),
      buttonLabel: read('buttonLabel'),
      buttonHref: read('buttonHref'),
      imageAlt: read('imageAlt'),
    });
  };

  return (
    <form action={action} onChange={report} className="grid gap-4">
      <CsrfField csrf={csrf} />
      {popup ? <input type="hidden" name="popupId" value={popup.id} /> : null}
      <ActionFeedback state={state} />

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          id={`popup-name-${id}`}
          label={tx('Name (for the team only)')}
          error={errors.internalName}
          required
          hint={tx('Never shown to customers; it is how this popup is found in the list.')}
        >
          {(control) => (
            <Input
              {...control}
              name="internalName"
              maxLength={POPUP_LIMITS.internalName}
              defaultValue={values?.internalName ?? popup?.internalName ?? ''}
              placeholder={tx('Eid campaign popup')}
            />
          )}
        </Field>
        <Field
          id={`popup-mode-${id}`}
          label={tx('Display mode')}
          error={errors.displayMode}
          required
          hint={tx(
            'Designed template: a picture plus your words. Complete artwork: one picture, shown as uploaded.',
          )}
        >
          {(control) => (
            <NativeSelect
              {...control}
              name="displayMode"
              value={mode}
              onChange={(event) => setMode(event.currentTarget.value as PopupDisplayMode)}
            >
              <option value="template">
                <AutoText>Designed template (picture + words)</AutoText>
              </option>
              <option value="artwork">
                <AutoText>Complete artwork (picture as uploaded)</AutoText>
              </option>
            </NativeSelect>
          )}
        </Field>
      </div>

      {mode === 'artwork' ? (
        <p className="text-sm text-muted-foreground">
          Complete artwork carries its own words, so no title, subtitle, description or button label
          is saved with it. An uploaded animated GIF keeps animating.
        </p>
      ) : (
        <div className="grid gap-4">
          <Field id={`popup-title-${id}`} label={tx('Title (optional)')} error={errors.title}>
            {(control) => (
              <Input
                {...control}
                name="title"
                maxLength={POPUP_LIMITS.title}
                defaultValue={values?.title ?? popup?.title ?? ''}
              />
            )}
          </Field>
          <Field
            id={`popup-subtitle-${id}`}
            label={tx('Subtitle (optional)')}
            error={errors.subtitle}
          >
            {(control) => (
              <Input
                {...control}
                name="subtitle"
                maxLength={POPUP_LIMITS.subtitle}
                defaultValue={values?.subtitle ?? popup?.subtitle ?? ''}
              />
            )}
          </Field>
          <Field
            id={`popup-description-${id}`}
            label={tx('Description (optional)')}
            error={errors.description}
          >
            {(control) => (
              <Textarea
                {...control}
                name="description"
                rows={3}
                maxLength={POPUP_LIMITS.description}
                defaultValue={values?.description ?? popup?.description ?? ''}
              />
            )}
          </Field>
        </div>
      )}

      <Field
        id={`popup-alt-${id}`}
        label={tx('Picture description (for screen readers)')}
        error={errors.imageAlt}
        hint={tx('Not shown on the page. Describe what the artwork shows.')}
      >
        {(control) => (
          <Input
            {...control}
            name="imageAlt"
            maxLength={POPUP_LIMITS.altText}
            defaultValue={values?.imageAlt ?? popup?.imageAlt ?? ''}
          />
        )}
      </Field>

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field
          id={`popup-button-label-${id}`}
          label={tx('Button label (optional)')}
          error={errors.buttonLabel}
        >
          {(control) => (
            <Input
              {...control}
              name="buttonLabel"
              maxLength={POPUP_LIMITS.buttonLabel}
              placeholder={tx('Shop the offer')}
              defaultValue={values?.buttonLabel ?? popup?.buttonLabel ?? ''}
            />
          )}
        </Field>
        <Field
          id={`popup-button-href-${id}`}
          label={tx('When tapped, go to')}
          error={errors.buttonHref}
          hint={tx(
            'A page inside the store. With complete artwork the whole picture becomes the link. Leave it empty for a popup that only informs.',
          )}
        >
          {(control) => (
            <div className="grid gap-2">
              <NativeSelect
                aria-label={tx('Kind of destination')}
                value={kind}
                onChange={(event) => choose(event.currentTarget.value as ClickKind)}
              >
                <option value="link">{tx('A store link (path)')}</option>
                <option value="product">{tx('A product')}</option>
                <option value="category">{tx('A category')}</option>
                <option value="screen">{tx('A screen')}</option>
              </NativeSelect>
              {kind === 'screen' ? (
                <NativeSelect
                  aria-label={tx('Screen')}
                  value={href}
                  onChange={(event) => setHref(event.currentTarget.value)}
                >
                  {SCREENS.map(([path, label]) => (
                    <option key={path} value={path}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              ) : null}
              <Input
                {...control}
                name="buttonHref"
                maxLength={300}
                spellCheck={false}
                readOnly={kind === 'screen'}
                value={href}
                onChange={(event) => setHref(event.currentTarget.value)}
                placeholder={
                  kind === 'product'
                    ? '/products/product-slug'
                    : kind === 'category'
                      ? '/categories/category-slug'
                      : '/categories/fashion'
                }
              />
            </div>
          )}
        </Field>
      </div>

      <div className="grid items-start gap-4 sm:grid-cols-3">
        <Field
          id={`popup-delay-${id}`}
          label={tx('Appears after (seconds)')}
          error={errors.delaySeconds}
          required
          hint={tx('0 to 120. 0 shows it as soon as the page or app opens.')}
        >
          {(control) => (
            <>
              <Input
                {...control}
                name="delaySeconds"
                type="number"
                inputMode="numeric"
                min={0}
                max={POPUP_MAX_DELAY_SECONDS}
                list={`popup-delay-presets-${id}`}
                defaultValue={String(values?.delaySeconds ?? popup?.delaySeconds ?? 10)}
              />
              <datalist id={`popup-delay-presets-${id}`}>
                {POPUP_DELAY_SECONDS.map((seconds) => (
                  <option key={seconds} value={seconds} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field
          id={`popup-frequency-${id}`}
          label={tx('How often')}
          error={errors.frequency}
          hint={tx(
            'Each device remembers, so the rule holds across visits without asking the server.',
          )}
        >
          {(control) => (
            <NativeSelect
              {...control}
              name="frequency"
              defaultValue={values?.frequency ?? popup?.frequency ?? 'once_per_session'}
            >
              {POPUP_FREQUENCIES.map((frequency) => (
                <option key={frequency} value={frequency}>
                  {POPUP_FREQUENCY_LABELS[frequency]} — {POPUP_FREQUENCY_HINTS[frequency]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field id={`popup-starts-${id}`} label={tx('Starts (BD time)')} error={errors.startsAt}>
          {(control) => (
            <Input
              {...control}
              name="startsAt"
              type="datetime-local"
              defaultValue={values?.startsAt ?? bdLocal(popup?.startsAt ?? null)}
            />
          )}
        </Field>
      </div>

      <div className="grid items-start gap-4 sm:grid-cols-3">
        <Field id={`popup-platform-${id}`} label={tx('Where it appears')} error={errors.platform}>
          {(control) => (
            <NativeSelect
              {...control}
              name="platform"
              defaultValue={values?.platform ?? popup?.platform ?? 'both'}
            >
              {POPUP_PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {POPUP_PLATFORM_LABELS[platform]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field id={`popup-audience-${id}`} label={tx('Who sees it')} error={errors.audience}>
          {(control) => (
            <NativeSelect
              {...control}
              name="audience"
              defaultValue={values?.audience ?? popup?.audience ?? 'all'}
            >
              {POPUP_AUDIENCES.map((audience) => (
                <option key={audience} value={audience}>
                  {POPUP_AUDIENCE_LABELS[audience]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field
          id={`popup-priority-${id}`}
          label={tx('Priority')}
          error={errors.priority}
          hint={tx('0 to 1000. When several popups are live, the highest is shown first.')}
        >
          {(control) => (
            <Input
              {...control}
              name="priority"
              type="number"
              inputMode="numeric"
              min={0}
              max={1000}
              defaultValue={String(values?.priority ?? popup?.priority ?? 0)}
            />
          )}
        </Field>
      </div>

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field id={`popup-ends-${id}`} label={tx('Ends (BD time)')} error={errors.endsAt}>
          {(control) => (
            <Input
              {...control}
              name="endsAt"
              type="datetime-local"
              defaultValue={values?.endsAt ?? bdLocal(popup?.endsAt ?? null)}
            />
          )}
        </Field>
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 self-end text-sm font-medium text-foreground">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={popup?.isActive ?? false}
            className="size-5 accent-primary-action"
          />
          <AutoText>Switch it on (live)</AutoText>
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        Several popups can be live. A customer sees the highest-priority one that fits their
        platform and sign-in state, once the frequency rule for their device allows it.
      </p>

      <div className="flex justify-end">
        <Button type="submit" loading={pending}>
          {popup ? 'Save popup' : 'Create popup'}
        </Button>
      </div>
    </form>
  );
}

/** The artwork: what is stored, its facts, and a replacement. */
export function PopupArtworkForm({ popup, csrf }: { popup: AdminPopup; csrf: CsrfInput }) {
  const [state, upload, uploading] = useActionState(uploadPopupArtworkAction, IDLE);
  const [removeState, remove, removing] = useActionState(removePopupArtworkAction, IDLE);
  const [picked, setPicked] = useState<File | null>(null);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-xl border border-hairline bg-surface-muted/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            <AutoText>Stored artwork</AutoText>
          </p>
          {popup.imageUrl === null ? null : (
            <p className="text-xs text-muted-foreground tabular-nums">
              {popup.imageWidth} × {popup.imageHeight} px · {formatBytes(popup.imageBytes ?? 0)} ·{' '}
              {popup.imageKind === 'animated' ? 'animated GIF' : popup.imageFormat}
            </p>
          )}
        </div>
        {popup.imageUrl === null ? (
          <p className="text-sm text-muted-foreground">
            No artwork yet. A popup cannot be shown without one, so upload a picture before
            switching it on.
          </p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- stored artwork from the media service
          <img
            src={popup.thumbUrl ?? popup.imageUrl}
            alt={`The artwork of ${popup.internalName}`}
            className="max-h-48 w-auto max-w-full justify-self-start rounded-lg border border-hairline bg-surface object-contain"
          />
        )}
        {popup.imageUrl === null ? null : (
          <form action={remove}>
            <CsrfField csrf={csrf} />
            <input type="hidden" name="popupId" value={popup.id} />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                variant="ghost"
                size="sm"
                loading={removing}
                className="max-sm:min-h-11"
              >
                <Trash2 aria-hidden="true" strokeWidth={1.75} />
                <AutoText>Remove artwork</AutoText>
              </Button>
              <ActionFeedback state={removeState} inline />
            </div>
          </form>
        )}
      </div>

      <form action={upload} className="grid gap-3">
        <CsrfField csrf={csrf} />
        <input type="hidden" name="popupId" value={popup.id} />
        <ActionFeedback state={state} />
        <p className="text-xs leading-relaxed text-muted-foreground">
          JPEG, PNG, WebP or animated GIF, at least 320 px on the shorter side and at most 5 MB.
          Recommended: 1200 × 860 (desktop), 900 × 900 (tablet), 750 × 1000 (phone). A GIF is kept
          exactly as uploaded so it keeps animating; every other picture is re-encoded as WebP.
        </p>
        <label className="grid cursor-pointer gap-1 rounded-xl border border-dashed border-input-border bg-surface px-4 py-4 text-sm transition-colors hover:bg-surface-muted/60 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
          <span className="flex items-center gap-2 font-medium text-foreground">
            <Upload aria-hidden="true" className="size-4 text-info-ink" strokeWidth={1.75} />
            {popup.imageUrl === null ? 'Upload artwork' : 'Replace artwork'}
          </span>
          <span className="text-xs text-muted-foreground">
            {picked === null ? 'Choose a picture.' : `${picked.name} · ${formatBytes(picked.size)}`}
          </span>
          <input
            type="file"
            name="image"
            accept={ACCEPT}
            required
            disabled={uploading}
            aria-label={`${popup.imageUrl === null ? 'Upload' : 'Replace'} artwork for ${popup.internalName}`}
            onChange={(event) => setPicked(event.currentTarget.files?.[0] ?? null)}
            className="sr-only"
          />
        </label>
        <div className="flex justify-end">
          <Button type="submit" variant="outline" loading={uploading} className="max-sm:min-h-11">
            {popup.imageUrl === null ? 'Upload' : 'Replace'}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Switches the popup on or off. */
export function PopupActiveForm({ popup, csrf }: { popup: AdminPopup; csrf: CsrfInput }) {
  const [state, action, pending] = useActionState(setPopupActiveAction, IDLE);
  const next = !popup.isActive;
  return (
    <form action={action} className="grid gap-2">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="popupId" value={popup.id} />
      <input type="hidden" name="active" value={String(next)} />
      <Button
        type="submit"
        variant={next ? 'primary' : 'outline'}
        loading={pending}
        className="max-sm:min-h-11"
      >
        {next ? 'Switch on (make live)' : 'Switch off'}
      </Button>
      <ActionFeedback state={state} inline />
    </form>
  );
}

export function DuplicatePopupForm({ popup, csrf }: { popup: AdminPopup; csrf: CsrfInput }) {
  const [state, action, pending] = useActionState(duplicatePopupAction, IDLE);
  return (
    <form action={action} className="grid gap-2">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="popupId" value={popup.id} />
      <Button type="submit" variant="outline" loading={pending} className="max-sm:min-h-11">
        <Copy aria-hidden="true" strokeWidth={1.75} />
        <AutoText>Duplicate</AutoText>
      </Button>
      <ActionFeedback state={state} inline />
    </form>
  );
}

export function DeletePopupForm({ popup, csrf }: { popup: AdminPopup; csrf: CsrfInput }) {
  const tx = useTx();
  const [state, action] = useActionState(deletePopupAction, IDLE);
  return (
    <ConfirmForm
      action={action}
      csrf={csrf}
      align="start"
      trigger={
        <>
          <Trash2 aria-hidden="true" strokeWidth={1.75} />
          Delete
        </>
      }
      triggerVariant="ghost"
      title={`Delete the popup “${popup.internalName}”?`}
      description={tx(
        'Its artwork is deleted with it. Customers still holding a cached copy stop seeing it within a minute. This cannot be undone.',
      )}
      confirmLabel={tx('Yes, delete the popup')}
      tone="danger"
      hiddenFields={{ popupId: popup.id }}
      error={state.status === 'error' ? state.message : undefined}
    />
  );
}

export interface PopupEditPanelProps {
  popup: AdminPopup;
  csrf: CsrfInput;
}

/** Everything an administrator can change about one saved popup, in one place. */
export function PopupEditPanel({ popup, csrf }: PopupEditPanelProps): ReactNode {
  const [draft, setDraft] = useState<PopupDraft | null>(null);
  return (
    <div className="grid gap-6 border-t border-hairline bg-neutral-soft/40 px-5 py-5">
      <PopupPreviews popup={popup} draft={draft} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid content-start gap-6">
          <PopupForm popup={popup} csrf={csrf} onDraft={setDraft} />
          <div className="flex items-start gap-2 rounded-xl border border-hairline bg-surface px-4 py-3">
            <Eye aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info-ink" />
            <p className="text-xs text-muted-foreground">
              {POPUP_PLATFORM_LABELS[popup.platform]} ·{' '}
              {POPUP_AUDIENCE_LABELS[popup.audience].toLowerCase()} · after {popup.delaySeconds}{' '}
              seconds · {POPUP_FREQUENCY_LABELS[popup.frequency].toLowerCase()} · priority{' '}
              {popup.priority} — and never on checkout or in the sign-in flow.
            </p>
          </div>
        </div>
        <div className="grid content-start gap-6">
          <PopupActiveForm popup={popup} csrf={csrf} />
          <PopupArtworkForm popup={popup} csrf={csrf} />
          <DuplicatePopupForm popup={popup} csrf={csrf} />
          <DeletePopupForm popup={popup} csrf={csrf} />
        </div>
      </div>
    </div>
  );
}
