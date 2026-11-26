'use client';

import type { PublicStoreProfile } from '@nilzora/contracts';
import { Button, Field, Input, Textarea } from '@nilzora/ui';
import {
  AtSign,
  Headset,
  MapPin,
  Save,
  Search,
  Smartphone,
  Store,
  Share2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useActionState, useState, type FormEvent, type ReactNode } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { SectionCard } from '@/components/admin-kit/section-card';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { Counter } from '@/components/catalog/catalog-ui';
import { useUnsavedChanges } from '@/components/catalog/use-unsaved-changes';
import { MediaKeyField } from '@/components/media/media-key-field';
import { saveStoreProfileAction } from '@/lib/site-actions';
import {
  checkStoreProfile,
  NEWER_STORE_FIELDS,
  STORE_LIMITS,
  type FieldErrors,
  type StoreField,
} from './site-rules';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

const TOUCH = 'max-sm:h-11';

const TEXT_FIELDS = (Object.keys(STORE_LIMITS) as StoreField[]).filter(
  (field) => field !== 'logoKey' && field !== 'ogImageKey',
);

/** The profile as the form's text values (an absent value is an empty field). */
export function profileTexts(profile: PublicStoreProfile): Record<StoreField, string> {
  return {
    displayName: profile.displayName,
    tagline: profile.tagline ?? '',
    description: profile.description ?? '',
    logoKey: profile.logoKey ?? '',
    contactEmail: profile.contactEmail ?? '',
    contactPhone: profile.contactPhone ?? '',
    addressLine: profile.addressLine ?? '',
    addressArea: profile.addressArea ?? '',
    addressDistrict: profile.addressDistrict ?? '',
    businessHours: profile.businessHours ?? '',
    supportEmail: profile.supportEmail ?? '',
    supportPhone: profile.supportPhone ?? '',
    socialFacebook: profile.social.facebook ?? '',
    socialInstagram: profile.social.instagram ?? '',
    socialYoutube: profile.social.youtube ?? '',
    socialTiktok: profile.social.tiktok ?? '',
    socialX: profile.social.x ?? '',
    whatsappNumber: profile.whatsappNumber ?? '',
    playStoreUrl: profile.playStoreUrl ?? '',
    appStoreUrl: profile.appStoreUrl ?? '',
    defaultSeoTitle: profile.defaultSeoTitle ?? '',
    defaultSeoDescription: profile.defaultSeoDescription ?? '',
    ogImageKey: profile.ogImageKey ?? '',
  };
}

/** The newer fields the loaded payload did not carry at all (an empty form must not clear them). */
export function absentFields(profile: PublicStoreProfile): string[] {
  const present: Record<(typeof NEWER_STORE_FIELDS)[number], unknown> = {
    whatsappNumber: profile.whatsappNumber,
    playStoreUrl: profile.playStoreUrl,
    appStoreUrl: profile.appStoreUrl,
    socialTiktok: profile.social.tiktok,
    socialX: profile.social.x,
  };
  return NEWER_STORE_FIELDS.filter((field) => present[field] === undefined);
}

function readTexts(form: HTMLFormElement): Record<string, string> {
  const data = new FormData(form);
  const texts: Record<string, string> = {};
  for (const field of Object.keys(STORE_LIMITS)) {
    const value = data.get(field);
    texts[field] = typeof value === 'string' ? value : '';
  }
  return texts;
}

interface TextFieldOptions {
  hint?: ReactNode;
  type?: string;
  multiline?: boolean;
  required?: boolean;
  placeholder?: string;
  mono?: boolean;
  /** Show how much of the limit is used. */
  counter?: boolean;
  inputMode?: 'tel' | 'email' | 'url' | 'text';
}

/**
 * The store's public face. Every field is checked with the contract's own schema before it
 * is sent (and again by the Server Action and the API); an empty field is simply not
 * published. Newer fields the loaded payload does not carry are kept, not cleared.
 */
export function StoreProfileForm({
  profile,
  csrf,
}: {
  profile: PublicStoreProfile;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action, pending] = useActionState(saveStoreProfileAction, IDLE_STATE);
  const initial = profileTexts(profile);
  const absent = absentFields(profile);
  const [texts, setTexts] = useState<Record<string, string>>(initial);
  const [mediaTouched, setMediaTouched] = useState(false);
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
  /** Changes on Discard, so the media fields start again from the saved pictures. */
  const [round, setRound] = useState(0);

  const dirty = mediaTouched || TEXT_FIELDS.some((field) => texts[field] !== initial[field]);
  useUnsavedChanges(dirty && !pending);

  // A saved profile makes the pictures the saved ones: adjust while rendering, as React advises.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.status === 'success') setMediaTouched(false);
  }

  const check = (next: Record<string, string>) => {
    const checked = checkStoreProfile(next, absent);
    setClientErrors(checked.ok ? {} : checked.errors);
  };
  const set = (field: string, value: string) => {
    const next = { ...texts, [field]: value };
    setTexts(next);
    check(next);
  };
  const error = (field: string) =>
    (visited.has(field) ? clientErrors[field] : undefined) ??
    (state.status === 'error' ? state.fieldErrors?.[field] : undefined);
  const visit = (field: string) => setVisited((previous) => new Set([...previous, field]));

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const all = readTexts(event.currentTarget);
    const checked = checkStoreProfile(all, absent);
    if (checked.ok) return;
    // Nothing is sent while a field is known to be wrong; the first one gets focus.
    event.preventDefault();
    setClientErrors(checked.errors);
    setVisited(new Set(Object.keys(checked.errors)));
    const first = Object.keys(checked.errors)[0];
    if (first) event.currentTarget.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  };

  const text = (name: StoreField, label: string, options: TextFieldOptions = {}) => {
    const limit = STORE_LIMITS[name];
    const value = texts[name] ?? '';
    return (
      <Field
        id={`profile-${name}`}
        label={label}
        required={options.required}
        error={error(name)}
        hint={
          options.hint || options.counter ? (
            <>
              {options.hint}
              {options.hint && options.counter ? ' ' : ''}
              {options.counter ? <Counter value={value} max={limit} /> : null}
            </>
          ) : undefined
        }
        className={options.multiline ? 'sm:col-span-2' : undefined}
      >
        {(control) =>
          options.multiline ? (
            <Textarea
              {...control}
              name={name}
              rows={3}
              value={value}
              onChange={(event) => set(name, event.currentTarget.value)}
              onBlur={() => visit(name)}
            />
          ) : (
            <Input
              {...control}
              name={name}
              type={options.type ?? 'text'}
              inputMode={options.inputMode}
              placeholder={options.placeholder}
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(event) => set(name, event.currentTarget.value)}
              onBlur={() => visit(name)}
              className={options.mono ? `font-mono ${TOUCH}` : TOUCH}
            />
          )
        }
      </Field>
    );
  };

  const section = (title: string, icon: LucideIcon, description: string, children: ReactNode) => (
    <SectionCard title={title} icon={icon} description={description} className="nz-panel-strong">
      {children}
    </SectionCard>
  );
  const grid = 'grid items-start gap-4 sm:grid-cols-2';

  return (
    <form
      action={action}
      noValidate
      onSubmit={onSubmit}
      onClickCapture={(event) => {
        // The only type="button" controls besides Discard belong to the media fields.
        const target = event.target as HTMLElement;
        if (target.closest('button[type="button"]') && !target.closest('[data-discard]')) {
          setMediaTouched(true);
        }
      }}
      onInput={(event) => {
        const name = (event.target as HTMLInputElement).name;
        if (name === 'logoKey' || name === 'ogImageKey') setMediaTouched(true);
      }}
      className="grid gap-6"
    >
      <CsrfField csrf={csrf} />
      <input type="hidden" name="absentFields" value={absent.join(',')} />

      {section(
        'Store identity',
        Store,
        'The name customers see everywhere, plus the logo and the short introduction used in the storefront header, the footer and the app. Only the store name is required.',
        <div className="grid gap-5">
          <div className={grid}>
            {text('displayName', 'Store name', {
              required: true,
              hint: 'Required. Appears in the header, footer, invoices and the app.',
              counter: true,
            })}
            {text('tagline', 'Tagline', {
              hint: 'One short line under the name, e.g. “Everyday essentials, delivered”.',
              counter: true,
            })}
            {text('description', 'About the store', {
              hint: 'Two or three sentences for customers: what you sell and what makes the store different.',
              multiline: true,
              counter: true,
            })}
          </div>
          <MediaKeyField
            key={`logo-${String(round)}`}
            name="logoKey"
            label={tx("Logo")}
            hint={tx("A square picture with a transparent or white background, at least 400 pixels, works best. Use the picker to upload or choose a picture without leaving this page. Empty keeps Nilzora’s own mark.")}
            defaultValue={profile.logoKey}
            previewUrl={profile.logoUrl}
            csrf={csrf}
          />
          {error('logoKey') ? (
            <p className="-mt-3 text-xs font-medium text-danger-ink"><AutoText value={error('logoKey')} /></p>
          ) : null}
        </div>,
      )}

      {section(
        'Contact & support',
        Headset,
        'Where customers write or call. “Contact” is for general questions; “support” is for help with an order. A field you leave empty is not published.',
        <div className={grid}>
          {text('contactEmail', 'Contact email', {
            type: 'email',
            inputMode: 'email',
            hint: 'A mailbox customers may write to, e.g. hello@yourstore.com.',
          })}
          {text('contactPhone', 'Contact phone', {
            type: 'tel',
            inputMode: 'tel',
            hint: 'Include the country code if the number is used from abroad.',
          })}
          {text('supportEmail', 'Support email', {
            type: 'email',
            inputMode: 'email',
            hint: 'Where order questions go. Often the same as the contact email.',
          })}
          {text('supportPhone', 'Support phone', {
            type: 'tel',
            inputMode: 'tel',
            hint: 'The number customers call about a delivery.',
          })}
        </div>,
      )}

      {section(
        'Address & opening hours',
        MapPin,
        'Leave the address empty if the store has no public address.',
        <div className={grid}>
          {text('addressLine', 'Street address')}
          {text('addressArea', 'Area')}
          {text('addressDistrict', 'District')}
          {text('businessHours', 'Business hours', {
            hint: 'For example: Saturday to Thursday, 10:00–20:00.',
          })}
        </div>,
      )}

      {section(
        'Social links',
        Share2,
        'Full https:// links to the store’s own profiles. Empty is simply not shown.',
        <div className={grid}>
          {text('socialFacebook', 'Facebook page', {
            type: 'url',
            inputMode: 'url',
            placeholder: 'https://www.facebook.com/…',
          })}
          {text('socialInstagram', 'Instagram profile', {
            type: 'url',
            inputMode: 'url',
            placeholder: 'https://www.instagram.com/…',
          })}
          {text('socialYoutube', 'YouTube channel', {
            type: 'url',
            inputMode: 'url',
            placeholder: 'https://www.youtube.com/…',
          })}
          {text('socialTiktok', 'TikTok profile', {
            type: 'url',
            inputMode: 'url',
            placeholder: 'https://www.tiktok.com/@name',
          })}
          {text('socialX', 'X profile', {
            type: 'url',
            inputMode: 'url',
            placeholder: 'https://x.com/name',
          })}
        </div>,
      )}

      {section(
        'Mobile app & messaging',
        Smartphone,
        'Where customers chat with the store and download the app.',
        <div className={grid}>
          {text('whatsappNumber', 'WhatsApp number', {
            type: 'tel',
            inputMode: 'tel',
            placeholder: '+8801712345678',
            mono: true,
            hint: 'A Bangladeshi mobile number with the +880 prefix.',
          })}
          <div className="hidden sm:block" />
          {text('playStoreUrl', 'Google Play listing', {
            type: 'url',
            inputMode: 'url',
            placeholder: 'https://play.google.com/store/apps/details?id=…',
            hint: 'The Android app’s page on Google Play.',
          })}
          {text('appStoreUrl', 'App Store listing', {
            type: 'url',
            inputMode: 'url',
            placeholder: 'https://apps.apple.com/…',
            hint: 'The iPhone app’s page on the App Store.',
          })}
        </div>,
      )}

      {section(
        'Default SEO & share image',
        Search,
        'Used by any page that does not set its own title, description or share picture — the home page and the static pages, for example. Product and category pages are edited under SEO.',
        <div className="grid gap-5">
          <div className={grid}>
            {text('defaultSeoTitle', 'Default search title', {
              hint: 'What search results show when a page has no title of its own. About 60 characters fit.',
              counter: true,
            })}
            {text('defaultSeoDescription', 'Default search description', {
              hint: 'One or two sentences describing the store. About 160 characters fit.',
              multiline: true,
              counter: true,
            })}
          </div>
          <MediaKeyField
            key={`og-${String(round)}`}
            name="ogImageKey"
            label={tx("Default share image")}
            hint={tx("The picture shown when a link to the store is shared and the page has no picture of its own. 1200 by 630 pixels, JPEG, PNG or WebP. Use the picker to upload or choose one.")}
            defaultValue={profile.ogImageKey}
            previewUrl={profile.ogImageUrl}
            csrf={csrf}
          />
          {error('ogImageKey') ? (
            <p className="-mt-3 text-xs font-medium text-danger-ink"><AutoText value={error('ogImageKey')} /></p>
          ) : null}
        </div>,
      )}

      <div className="sticky bottom-3 z-30 sm:bottom-4">
        <div className="nz-glass grid gap-3 rounded-2xl border px-4 py-3 shadow-glass-lg sm:px-5">
          <ActionFeedback state={state} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <AtSign aria-hidden="true" className="size-4" strokeWidth={1.75} />
              {dirty ? (
                <>
                  <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
                  <span className="font-medium text-foreground"><AutoText>Unsaved changes</AutoText></span>
                </>
              ) : (
                'Everything here is shown to customers.'
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {dirty ? (
                <Button
                  type="button"
                  variant="ghost"
                  data-discard=""
                  disabled={pending}
                  onClick={() => {
                    setRound((value) => value + 1);
                    setMediaTouched(false);
                    setTexts(initial);
                    setClientErrors({});
                    setVisited(new Set());
                  }}
                  className="max-sm:min-h-11 max-sm:flex-1"
                >
                  <Undo2 aria-hidden="true" strokeWidth={1.75} /><AutoText>Discard</AutoText></Button>
              ) : null}
              <Button type="submit" loading={pending} className="max-sm:min-h-11 max-sm:flex-1">
                {pending ? null : <Save aria-hidden="true" strokeWidth={1.75} />}
                Save store profile
              </Button>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
