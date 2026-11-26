import type {
  ImageSearchActivity,
  ImageSearchMissingImage,
  ImageSearchStats,
} from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { Activity, AlertTriangle, CheckCircle2, Hourglass, ImageOff, Layers } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import { ReadState } from '@/components/admin-kit/states';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { DateTimeText } from '@/components/i18n/format-text';
import { IMAGE_SEARCH_PATH } from '@/lib/image-search-path';
import { ImageSearchJobControls } from './job-controls';
import { ImageSearchSettingsForm } from './settings-form';

/*
 * Settings -> Image Search (image_search.manage)
 * ----------------------------------------------
 * Everything on this screen is read from the database when the page renders: the counts, the
 * jobs, the list of products with no usable picture and the anonymised search log. Nothing is
 * a placeholder, and nothing is estimated: "Indexed" is a count of rows, "Last indexed" is the
 * newest timestamp the index wrote.
 */

export { IMAGE_SEARCH_PATH } from '@/lib/image-search-path';

const REASON_LABEL: Record<string, string> = {
  no_images: 'No picture uploaded',
  unknown_dimensions: 'Picture size could not be read',
  too_small: 'Shorter side is under 128 px',
  too_large: 'Picture is larger than 6000 px',
  corrupt: 'The file could not be decoded',
  undecodable: 'The file could not be decoded',
  placeholder: 'Looks like a placeholder, not a product',
  unsupported_format: 'Not a JPEG, PNG or WebP file',
  host_not_allowed: 'Picture is hosted outside the store\u2019s media',
  variant_unavailable: 'A variant picture could not be read',
  ineligible: 'Not eligible for indexing',
  empty: 'The file is empty',
};

function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason;
}

function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  hint?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'danger'
          ? 'text-error'
          : 'text-foreground';
  return (
    <div className="nz-panel grid gap-1 rounded-2xl border p-4">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className={cn('text-2xl font-semibold tabular-nums', toneClass)}>{value}</span>
      {hint === undefined ? null : <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function Pager({
  total,
  limit,
  offset,
  hrefFor,
}: {
  total: number;
  limit: number;
  offset: number;
  hrefFor: (offset: number) => Route;
}) {
  if (total <= limit) {
    return <p className="px-4 py-3 text-xs text-muted-foreground">{total} in total</p>;
  }
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
      <span className="text-muted-foreground">
        Page {page} of {pages} · {total} in total
      </span>
      <span className="flex gap-2">
        {offset > 0 ? (
          <Link href={hrefFor(Math.max(0, offset - limit))} className="font-semibold text-link hover:underline">
            Previous
          </Link>
        ) : null}
        {offset + limit < total ? (
          <Link href={hrefFor(offset + limit)} className="font-semibold text-link hover:underline">
            Next
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

export interface ImageSearchViewProps {
  csrf: CsrfInput;
  /** The filter typed into either table (one shared box keeps the page simple). */
  q: string;
  /** Offsets for the two paginated tables. */
  missingOffset: number;
  activityOffset: number;
}

export async function ImageSearchView({ csrf, q, missingOffset, activityOffset }: ImageSearchViewProps) {
  const [statsRead, missingRead, activityRead] = await Promise.all([
    adminRead((api, token) => api.adminImageSearch(token)),
    adminRead((api, token) =>
      api.adminImageSearchMissingImages(token, {
        ...(q === '' ? {} : { q }),
        page: Math.floor(missingOffset / 10) + 1,
        pageSize: 10,
      }),
    ),
    adminRead((api, token) =>
      api.adminImageSearchActivity(token, {
        ...(q === '' ? {} : { q }),
        page: Math.floor(activityOffset / 10) + 1,
        pageSize: 10,
      }),
    ),
  ]);

  if (statsRead.kind === 'signed_out') redirect('/login');
  if (statsRead.kind !== 'ok') {
    return (
      <section className="nz-panel rounded-2xl border">
        <ReadState failure={statsRead.kind} retryHref={IMAGE_SEARCH_PATH} permission="image_search.manage" />
      </section>
    );
  }

  const stats: ImageSearchStats = statsRead.value;
  const activeJob = stats.jobs.find((job) => job.status === 'queued' || job.status === 'running');
  const missing = missingRead.kind === 'ok' ? missingRead.value : null;
  const activity = activityRead.kind === 'ok' ? activityRead.value : null;

  return (
    <div className="grid gap-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Indexed pictures"
          value={stats.indexed}
          hint={`${stats.uniqueVectors} unique vectors`}
          tone="success"
        />
        <Stat label="Pending" value={stats.pending} hint={`${stats.processing} being embedded`} tone="warning" />
        <Stat label="Failed" value={stats.failed} hint="Retried, still failing" tone={stats.failed > 0 ? 'danger' : 'neutral'} />
        <Stat
          label="Excluded"
          value={stats.excluded}
          hint="Not eligible (too small, placeholder, unreadable)"
        />
      </section>

      <section className="grid gap-2 rounded-2xl border border-border bg-surface-muted/60 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <span>
            <span className="text-muted-foreground">Eligible pictures: </span>
            <span className="font-semibold tabular-nums">{stats.eligible}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Products: </span>
            <span className="font-semibold tabular-nums">
              {stats.products} ({stats.activeProducts} on sale)
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">Last indexed: </span>
            {stats.lastIndexedAt === null ? (
              <span className="font-semibold">never</span>
            ) : (
              <span className="font-semibold"><DateTimeText value={stats.lastIndexedAt} style="datetime" /></span>
            )}
          </span>
        </div>
        {Object.entries(stats.vectorsByModel).length > 1 ? (
          <p className="text-xs text-warning">
            Vectors exist for more than one model. Only the configured model is searched; reindex
            to replace the others.
          </p>
        ) : null}
        {!stats.provider.matchesStoredModel ? (
          <p className="flex items-start gap-2 text-xs text-warning">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            The settings record the model &quot;{stats.settings.model}&quot; but this API produces
            &quot;{stats.provider.model}&quot;. Run a full reindex before customers rely on the
            results.
          </p>
        ) : null}
      </section>

      <SectionCard
        icon={Layers}
        title="Settings"
        description="Whether customers can search by image, how close a match must be, and how many results a search may return."
      >
        <ImageSearchSettingsForm
          enabled={stats.settings.enabled}
          similarityThreshold={stats.settings.similarityThreshold}
          maxResults={stats.settings.maxResults}
          csrf={csrf}
        />
        <dl className="mt-4 grid gap-2 rounded-xl border border-border bg-surface-muted/60 p-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Embedding model</dt>
            <dd className="font-medium break-all">{stats.provider.model}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Model version</dt>
            <dd className="font-medium">{stats.provider.modelVersion}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Dimensions</dt>
            <dd className="font-medium tabular-nums">{stats.provider.dimensions}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-muted-foreground">
          The model comes from the API&apos;s server configuration (IMAGE_EMBEDDING_*); it is not
          editable here because a value typed in a browser could not change what the server
          produces.
        </p>
      </SectionCard>

      <SectionCard
        icon={Hourglass}
        title="Index management"
        description="Indexing runs in the background. Backfill adds pictures the index has never seen; reindex embeds every eligible picture again; retry re-queues the failures."
      >
        <ImageSearchJobControls
          csrf={csrf}
          busy={activeJob !== undefined}
          failedCount={stats.failed}
        />
        {stats.jobs.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No indexing job has run yet.</p>
        ) : (
          <ul className="mt-4 grid gap-2">
            {stats.jobs.slice(0, 5).map((job) => {
              const done = job.indexed + job.failed + job.excluded;
              const percent = job.total === 0 ? 0 : Math.min(100, Math.round((done / job.total) * 100));
              return (
                <li key={job.id} className="grid gap-1 rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="font-semibold">
                      {job.kind === 'reindex_all'
                        ? 'Full reindex'
                        : job.kind === 'retry_failed'
                          ? 'Retry failed'
                          : 'Backfill'}
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-semibold',
                        job.status === 'completed'
                          ? 'bg-success/10 text-success'
                          : job.status === 'failed'
                            ? 'bg-error/10 text-error'
                            : 'bg-warning/10 text-warning',
                      )}
                    >
                      {job.status}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-border" role="presentation">
                    <div className="h-full rounded-full bg-primary-action" style={{ width: `${percent}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {done} / {job.total} · {job.indexed} indexed · {job.failed} failed ·{' '}
                    {job.excluded} excluded
                    {job.finishedAt !== null ? (
                      <>
                        {' '}
                        · finished <DateTimeText value={job.finishedAt} style="time" />
                      </>
                    ) : null}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        icon={ImageOff}
        title="Products without a usable picture"
        description="These products cannot appear in image results until they have an eligible picture. Open a product to add or replace one."
        flush
      >
        {missing === null ? (
          <div className="p-4">
            <ReadState
              failure={missingRead.kind === 'ok' || missingRead.kind === 'signed_out' ? 'unavailable' : missingRead.kind}
              retryHref={IMAGE_SEARCH_PATH}
              permission="image_search.manage"
            />
          </div>
        ) : missing.items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Every product has at least one indexed picture.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs tracking-wide text-muted-foreground uppercase">
                    <th className="px-4 py-2 font-medium">Product</th>
                    <th className="px-4 py-2 font-medium">SKU</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Pictures</th>
                    <th className="px-4 py-2 font-medium">Why it cannot be indexed</th>
                    <th className="px-4 py-2 font-medium">
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {missing.items.map((item: ImageSearchMissingImage) => (
                    <tr key={item.productId} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2 font-medium">{item.name}</td>
                      <td className="px-4 py-2 text-muted-foreground">{item.sku}</td>
                      <td className="px-4 py-2 text-muted-foreground">{item.productStatus}</td>
                      <td className="px-4 py-2 tabular-nums text-muted-foreground">
                        {item.images} ({item.indexed} indexed, {item.excluded} excluded)
                      </td>
                      <td className="px-4 py-2">{reasonLabel(item.reason)}</td>
                      <td className="px-4 py-2 text-right">
                        <Link
                          href={`/admin/products/${item.productId}` as Route}
                          className="font-semibold text-link hover:underline"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              total={missing.total}
              limit={missing.limit}
              offset={missingOffset}
              hrefFor={(offset) =>
                `${IMAGE_SEARCH_PATH}?missing=${offset}${q === '' ? '' : `&q=${encodeURIComponent(q)}`}` as Route
              }
            />
          </>
        )}
      </SectionCard>

      <SectionCard
        icon={Activity}
        title="Recent search activity"
        description="What customers searched for, anonymously: the hash of the prepared picture, the model, how many matched, and which result was opened. The photographs themselves are never stored."
        flush
      >
        {activity === null ? (
          <div className="p-4">
            <ReadState
              failure={activityRead.kind === 'ok' || activityRead.kind === 'signed_out' ? 'unavailable' : activityRead.kind}
              retryHref={IMAGE_SEARCH_PATH}
              permission="image_search.manage"
            />
          </div>
        ) : activity.items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No image searches have been made yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs tracking-wide text-muted-foreground uppercase">
                    <th className="px-4 py-2 font-medium">When</th>
                    <th className="px-4 py-2 font-medium">Image hash</th>
                    <th className="px-4 py-2 font-medium">Matches</th>
                    <th className="px-4 py-2 font-medium">Top product</th>
                    <th className="px-4 py-2 font-medium">Opened</th>
                    <th className="px-4 py-2 font-medium">Outcome</th>
                    <th className="px-4 py-2 font-medium">Took</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.items.map((row: ImageSearchActivity) => (
                    <tr key={row.id} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2 whitespace-nowrap">
                        <DateTimeText value={row.createdAt} style="datetime" />
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{row.imageHash?.slice(0, 12) ?? '—'}</td>
                      <td className="px-4 py-2 tabular-nums">{row.resultCount}</td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {row.topProductIds[0]?.slice(0, 8) ?? '—'}
                      </td>
                      <td className="px-4 py-2">
                        {row.clickedProductName ?? (row.clickedProductId === null ? '—' : 'yes')}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-xs font-semibold',
                            row.outcome === 'results'
                              ? 'bg-success/10 text-success'
                              : row.outcome === 'no_results'
                                ? 'bg-warning/10 text-warning'
                                : 'bg-surface-muted',
                          )}
                        >
                          {row.outcome.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-2 tabular-nums text-muted-foreground">
                        {row.durationMs === null ? '—' : `${row.durationMs} ms`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              total={activity.total}
              limit={activity.limit}
              offset={activityOffset}
              hrefFor={(offset) =>
                `${IMAGE_SEARCH_PATH}?activity=${offset}${q === '' ? '' : `&q=${encodeURIComponent(q)}`}` as Route
              }
            />
          </>
        )}
      </SectionCard>

      <section className="grid gap-2 rounded-2xl border border-border bg-surface p-4">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 aria-hidden="true" className="size-4 text-success" />
          Pictures are embedded by {stats.provider.model} locally; the model never sees customer
          photographs beyond the single search that sent them.
        </p>
      </section>
    </div>
  );
}
