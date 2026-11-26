'use client';

import type { AdminSitePage } from '@nilzora/contracts';
import { SITE_PAGE_SLUGS } from '@nilzora/contracts';
import {
  Field,
  Input,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@nilzora/ui';
import { FileText, Pencil, Save } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useActionState, useState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { Chip } from '@/components/admin-kit/chip';
import { DataTable } from '@/components/admin-kit/data-table';
import { SectionCard } from '@/components/admin-kit/section-card';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { Counter, GlassTable } from '@/components/catalog/catalog-ui';
import { useUnsavedChanges } from '@/components/catalog/use-unsaved-changes';
import { formatDateTime } from '@/lib/format';
import { saveSitePageAction } from '@/lib/content-actions';
import {
  checkSitePage,
  SITE_PAGE_LABELS,
  SITE_PAGE_LIMITS,
  storefrontPagePath,
  type FieldErrors,
} from './content-rules';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

export function sitePageHref(slug: AdminSitePage['slug']): Route {
  return `/admin/pages/${slug}` as Route;
}

function StateChip({ page }: { page: AdminSitePage }) {
  if (page.updatedAt === null) return <Chip tone="neutral"><AutoText>Not written yet</AutoText></Chip>;
  return page.isPublished ? (
    <Chip tone="success" dot><AutoText>Published</AutoText></Chip>
  ) : (
    <Chip tone="warning" dot><AutoText>Draft</AutoText></Chip>
  );
}

/** The six pages a store needs, written or not, with their state and where they live. */
export function SitePagesList({ pages }: { pages: readonly AdminSitePage[] }) {
  const tx = useTx();
  const bySlug = new Map(pages.map((page) => [page.slug, page]));
  return (
    <GlassTable label={tx("Static pages")}>
      <DataTable caption="Static pages" dense>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead><AutoText>Page</AutoText></TableHead>
            <TableHead><AutoText>Storefront address</AutoText></TableHead>
            <TableHead><AutoText>State</AutoText></TableHead>
            <TableHead className="hidden md:table-cell"><AutoText>Updated</AutoText></TableHead>
            <TableHead>
              <span className="sr-only"><AutoText>Actions</AutoText></span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {SITE_PAGE_SLUGS.map((slug) => {
            const page = bySlug.get(slug);
            return (
              <TableRow key={slug}>
                <TableCell>
                  <Link
                    href={sitePageHref(slug)}
                    className="font-medium text-foreground underline-offset-4 hover:text-link hover:underline"
                  >
                    {page?.title || SITE_PAGE_LABELS[slug]}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {storefrontPagePath(slug)}
                </TableCell>
                <TableCell>
                  {page ? <StateChip page={page} /> : <Chip tone="neutral"><AutoText>Not written yet</AutoText></Chip>}
                </TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">
                  {page?.updatedAt ? formatDateTime(page.updatedAt) : '—'}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={sitePageHref(slug)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-link ring-1 ring-hairline hover:bg-info-soft/50 max-sm:h-11"
                  >
                    <Pencil aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
                    Edit <span className="sr-only">{SITE_PAGE_LABELS[slug]}</span>
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </DataTable>
    </GlassTable>
  );
}

const TOUCH = 'max-sm:h-11';

/**
 * One static page. The text is plain text, never HTML: blank lines separate paragraphs, a
 * line starting "# " or "## " is a heading and one starting "- " a list item. A published
 * page needs text; visitors see only published pages.
 */
export function SitePageForm({ page, csrf }: { page: AdminSitePage; csrf: CsrfInput }) {
  const tx = useTx();
  const [state, action] = useActionState(saveSitePageAction, IDLE_STATE);
  const saved = {
    title: page.updatedAt === null ? SITE_PAGE_LABELS[page.slug] : page.title,
    body: page.body,
    seoTitle: page.seoTitle ?? '',
    seoDescription: page.seoDescription ?? '',
  };
  const [values, setValues] = useState(saved);
  const [published, setPublished] = useState(page.isPublished);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());

  const dirty =
    published !== page.isPublished ||
    (Object.keys(saved) as (keyof typeof saved)[]).some((field) => values[field] !== saved[field]);
  useUnsavedChanges(dirty);

  const recheck = (next: typeof values, nextPublished: boolean) => {
    const checked = checkSitePage(next, nextPublished);
    setErrors(checked.ok ? {} : checked.errors);
  };
  const set = (field: keyof typeof saved, value: string) => {
    const next = { ...values, [field]: value };
    setValues(next);
    recheck(next, published);
  };
  const error = (field: string) =>
    (visited.has(field) ? errors[field] : undefined) ??
    (state.status === 'error' ? state.fieldErrors?.[field] : undefined);
  const visit = (field: string) => setVisited((previous) => new Set([...previous, field]));

  return (
    <form
      action={action}
      noValidate
      onSubmit={(event) => {
        const checked = checkSitePage(values, published);
        if (checked.ok) return;
        event.preventDefault();
        setErrors(checked.errors);
        setVisited(new Set(Object.keys(checked.errors)));
      }}
      className="grid gap-6"
    >
      <CsrfField csrf={csrf} />
      <input type="hidden" name="slug" value={page.slug} />

      <SectionCard
        title={tx("Content")}
        icon={FileText}
        description={tx("Plain text only. Blank lines separate paragraphs; start a line with “# ” or “## ” for a heading and “- ” for a list item.")}
        className="nz-panel-strong"
      >
        <div className="grid gap-5">
          <Field
            id="page-title"
            label={tx("Title")}
            required
            error={error('title')}
            hint={<Counter value={values.title} max={SITE_PAGE_LIMITS.title} />}
          >
            {(control) => (
              <Input
                {...control}
                name="title"
                value={values.title}
                onChange={(event) => set('title', event.currentTarget.value)}
                onBlur={() => visit('title')}
                className={TOUCH}
              />
            )}
          </Field>
          <Field
            id="page-body"
            label={tx("Text")}
            error={error('body')}
            hint={<Counter value={values.body} max={SITE_PAGE_LIMITS.body} />}
          >
            {(control) => (
              <Textarea
                {...control}
                name="body"
                rows={18}
                value={values.body}
                onChange={(event) => set('body', event.currentTarget.value)}
                onBlur={() => visit('body')}
                className="font-mono text-[13px] leading-relaxed"
              />
            )}
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        title={tx("Search metadata")}
        description={tx("Optional. Empty falls back to the page title.")}
        className="nz-panel-strong"
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="page-seoTitle"
            label={tx("Search title")}
            error={error('seoTitle')}
            hint={<Counter value={values.seoTitle} max={SITE_PAGE_LIMITS.seoTitle} />}
          >
            {(control) => (
              <Input
                {...control}
                name="seoTitle"
                value={values.seoTitle}
                onChange={(event) => set('seoTitle', event.currentTarget.value)}
                onBlur={() => visit('seoTitle')}
                className={TOUCH}
              />
            )}
          </Field>
          <Field
            id="page-seoDescription"
            label={tx("Search description")}
            error={error('seoDescription')}
            hint={<Counter value={values.seoDescription} max={SITE_PAGE_LIMITS.seoDescription} />}
          >
            {(control) => (
              <Textarea
                {...control}
                name="seoDescription"
                rows={3}
                value={values.seoDescription}
                onChange={(event) => set('seoDescription', event.currentTarget.value)}
                onBlur={() => visit('seoDescription')}
              />
            )}
          </Field>
        </div>
      </SectionCard>

      <div className="sticky bottom-3 z-30 sm:bottom-4">
        <div className="nz-glass grid gap-3 rounded-2xl border px-4 py-3 shadow-glass-lg sm:px-5">
          <ActionFeedback state={state} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex min-h-11 items-start gap-2.5 text-sm text-foreground">
              <input
                type="checkbox"
                name="isPublished"
                checked={published}
                onChange={(event) => {
                  setPublished(event.currentTarget.checked);
                  recheck(values, event.currentTarget.checked);
                }}
                className="mt-0.5 size-5 shrink-0 accent-primary-action"
              />
              <span className="grid gap-0.5">
                <span className="font-medium"><AutoText>Published</AutoText></span>
                <span className="text-xs text-muted-foreground">
                  Visitors see it at {storefrontPagePath(page.slug)}. A draft is hidden.
                </span>
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              {dirty ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span aria-hidden="true" className="size-2 rounded-full bg-warning" /><AutoText>Unsaved changes</AutoText></p>
              ) : null}
              <SubmitButton pendingLabel="Saving…" className="max-sm:min-h-11">
                <Save aria-hidden="true" strokeWidth={1.75} /><AutoText>Save page</AutoText></SubmitButton>
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}
