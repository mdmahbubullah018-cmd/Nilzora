'use client';

import type { SeoOverviewRow } from '@nilzora/contracts';
import { Button, Field, Input, Textarea } from '@nilzora/ui';
import { Link2, Save, Search, Share2, Type } from 'lucide-react';
import { useActionState, useState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { SectionCard } from '@/components/admin-kit/section-card';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { Counter } from '@/components/catalog/catalog-ui';
import { useUnsavedChanges } from '@/components/catalog/use-unsaved-changes';
import { MediaKeyField } from '@/components/media/media-key-field';
import { saveSeoAction } from '@/lib/site-actions';
import { checkSeo, SEO_LIMITS, storefrontPath, type FieldErrors } from './site-rules';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

const TOUCH = 'max-sm:h-11';

/** The search-result preview: what the title, address and description are likely to read like. */
export function SearchPreview({
  kind,
  slug,
  name,
  seoTitle,
  seoDescription,
  canonicalPath,
}: {
  kind: 'product' | 'category';
  slug: string;
  name: string;
  seoTitle: string;
  seoDescription: string;
  canonicalPath: string;
}) {
  const path = canonicalPath.trim() === '' ? storefrontPath(kind, slug) : canonicalPath.trim();
  return (
    <div className="nz-panel-strong grid gap-0.5 rounded-xl border p-4" data-testid="seo-preview">
      <p className="truncate text-xs text-success-ink">{`https://nilzora.com${path}`}</p>
      <p className="text-lg leading-snug text-info-ink">
        {seoTitle.trim() === '' ? name : seoTitle.trim()}
      </p>
      <p className="text-sm text-muted-foreground">
        {seoDescription.trim() === '' ? 'No search description yet.' : seoDescription.trim()}
      </p>
    </div>
  );
}

/**
 * The search metadata of one product or category. Counters guide each field by the same
 * limits the contract enforces; the form checks them before it sends and the Server Action
 * checks them again. Without products.update everything is shown but nothing can change.
 */
export function SeoEditorForm({
  entry,
  canEdit,
  csrf,
}: {
  entry: SeoOverviewRow;
  canEdit: boolean;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, action] = useActionState(saveSeoAction, IDLE_STATE);
  const saved = {
    seoTitle: entry.seoTitle ?? '',
    seoDescription: entry.seoDescription ?? '',
    ogTitle: entry.ogTitle ?? '',
    ogDescription: entry.ogDescription ?? '',
    canonicalPath: entry.canonicalPath ?? '',
    ogImageKey: entry.ogImageKey ?? '',
  };
  const [values, setValues] = useState(saved);
  const [noIndex, setNoIndex] = useState(entry.noIndex);
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());

  const dirty =
    noIndex !== entry.noIndex ||
    (Object.keys(saved) as (keyof typeof saved)[]).some((field) => values[field] !== saved[field]);
  useUnsavedChanges(canEdit && dirty);

  const recheck = (next: typeof values, hide: boolean) => {
    const checked = checkSeo(next, hide);
    setClientErrors(checked.ok ? {} : checked.errors);
  };
  const set = (field: keyof typeof saved, value: string) => {
    const next = { ...values, [field]: value };
    setValues(next);
    recheck(next, noIndex);
  };
  const error = (field: string) =>
    (visited.has(field) ? clientErrors[field] : undefined) ??
    (state.status === 'error' ? state.fieldErrors?.[field] : undefined);
  const visit = (field: string) => setVisited((previous) => new Set([...previous, field]));

  const text = (
    field: Exclude<keyof typeof saved, 'ogImageKey'>,
    label: string,
    hint: string,
    multiline = false,
  ) => {
    const limit = SEO_LIMITS[field];
    return (
      <Field
        id={`seo-${field}`}
        label={label}
        error={error(field)}
        hint={
          <>
            {hint} <Counter value={values[field]} max={limit} />
          </>
        }
      >
        {(control) =>
          multiline ? (
            <Textarea
              {...control}
              name={field}
              rows={3}
              value={values[field]}
              onChange={(event) => set(field, event.currentTarget.value)}
              onBlur={() => visit(field)}
            />
          ) : (
            <Input
              {...control}
              name={field}
              value={values[field]}
              onChange={(event) => set(field, event.currentTarget.value)}
              onBlur={() => visit(field)}
              className={field === 'canonicalPath' ? `font-mono ${TOUCH}` : TOUCH}
            />
          )
        }
      </Field>
    );
  };

  return (
    <form
      action={action}
      noValidate
      onSubmit={(event) => {
        const checked = checkSeo(values, noIndex);
        if (checked.ok) return;
        // Nothing is sent while a field is known to be wrong.
        event.preventDefault();
        setClientErrors(checked.errors);
        setVisited(new Set(Object.keys(checked.errors)));
      }}
      className="grid gap-6"
    >
      <CsrfField csrf={csrf} />
      <input type="hidden" name="kind" value={entry.kind} />
      <input type="hidden" name="targetId" value={entry.id} />
      <fieldset disabled={!canEdit} className="grid min-w-0 gap-6">
        <legend className="sr-only">
          <AutoText>Search metadata</AutoText>
        </legend>

        <SectionCard
          title={tx('What customers see in search results')}
          icon={Search}
          description={tx(
            'Roughly how this page could look in Google. Search engines may rewrite the text, so aim for an honest description rather than a list of keywords.',
          )}
        >
          <SearchPreview
            kind={entry.kind}
            slug={entry.slug}
            name={entry.name}
            seoTitle={values.seoTitle}
            seoDescription={values.seoDescription}
            canonicalPath={values.canonicalPath}
          />
        </SectionCard>

        <SectionCard
          title={tx('Search title and description')}
          icon={Type}
          description={
            canEdit
              ? 'Both fields are optional. Leave one empty and the page’s own name or summary is used instead, so the page is never without a title.'
              : 'Your account can read this page but not change it.'
          }
        >
          <div className="grid gap-5">
            {text(
              'seoTitle',
              'Search title',
              'Say what the page offers, for example “Cotton panjabi for men”. About 60 characters fit in a search result.',
            )}
            {text(
              'seoDescription',
              'Search description',
              'One or two sentences a customer would recognise: what it is, who it is for, and why it is worth opening. About 160 characters fit.',
              true,
            )}
          </div>
        </SectionCard>

        <SectionCard
          title={tx('Sharing on social networks')}
          icon={Share2}
          description={tx(
            'What appears when someone pastes this page into Facebook, WhatsApp or X. A field you leave empty uses the search title or description above.',
          )}
        >
          <div className="grid gap-5">
            {text(
              'ogTitle',
              'Share title',
              'The headline of the shared card. Keep it short — the picture takes the rest of the space.',
            )}
            {text(
              'ogDescription',
              'Share description',
              'One line under the share title. Empty uses the search description.',
              true,
            )}
            <MediaKeyField
              name="ogImageKey"
              label={tx('Share image')}
              hint={tx(
                'The picture in the shared card. 1200 by 630 pixels, JPEG, PNG or WebP. Use the picker to upload a new picture or choose one from the library; empty uses the store’s default share image.',
              )}
              defaultValue={entry.ogImageKey}
              csrf={csrf}
            />
            {error('ogImageKey') ? (
              <p className="-mt-3 text-xs font-medium text-danger-ink">
                <AutoText value={error('ogImageKey')} />
              </p>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title={tx('Address and search engine indexing')}
          icon={Link2}
          description={tx(
            'Advanced. Change these only if the page’s address has moved, or if it must stay out of search results. Neither changes the page itself.',
          )}
        >
          <div className="grid gap-4">
            {text(
              'canonicalPath',
              'Canonical path',
              'The one address search engines should treat as this page, written as a path on this site, for example /products/casual-t-shirt. Empty uses the page’s own address.',
            )}
            <div className="grid gap-1">
              <label className="flex min-h-11 items-center gap-2.5 text-sm text-foreground">
                <input
                  type="checkbox"
                  name="noIndex"
                  checked={noIndex}
                  aria-describedby="seo-noindex-hint"
                  onChange={(event) => {
                    setNoIndex(event.currentTarget.checked);
                    recheck(values, event.currentTarget.checked);
                  }}
                  className="size-5 shrink-0 accent-primary-action"
                />
                <AutoText>Hide this page from search engines</AutoText>
              </label>
              <p id="seo-noindex-hint" className="pl-8 text-xs text-muted-foreground">
                Anyone with the link can still open it; it simply stops appearing in search results.
              </p>
            </div>
          </div>
        </SectionCard>
      </fieldset>

      <div className="sticky bottom-3 z-30 sm:bottom-4">
        <div className="nz-glass grid gap-3 rounded-2xl border px-4 py-3 shadow-glass-lg sm:px-5">
          <ActionFeedback state={state} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              {dirty ? (
                <>
                  <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
                  <span className="font-medium text-foreground">
                    <AutoText>Unsaved changes</AutoText>
                  </span>
                </>
              ) : (
                'Saving publishes these values to the storefront.'
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {canEdit ? (
                <SubmitButton pendingLabel="Saving…" className="max-sm:min-h-11 max-sm:flex-1">
                  <Save aria-hidden="true" strokeWidth={1.75} />
                  <AutoText>Save metadata</AutoText>
                </SubmitButton>
              ) : (
                <Button type="submit" disabled>
                  <AutoText>Save metadata</AutoText>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
