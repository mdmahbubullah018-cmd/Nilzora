import type { MediaListResponse } from '@nilzora/contracts';
import { formatBytes } from '@nilzora/ui';
import { Images, SearchX, Upload } from 'lucide-react';
import type { Route } from 'next';
import {
  FilterBar,
  FilterChips,
  PageToolbar,
  Pagination,
  SearchFilter,
  SectionCard,
  withQuery,
} from '@/components/admin-kit';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { EmptyPanel, ViewOnly } from '@/components/catalog/catalog-ui';
import { CopyButton, MediaAssetControls, MediaUploader } from './media-controls';
import { AutoText } from '@/components/i18n/translate';
import { CountText, DateTimeText } from '@/components/i18n/format-text';

export const MEDIA_PATH = '/admin/media' as Route;
export const MEDIA_PAGE_SIZE = 24;

export interface MediaFilters {
  q?: string | undefined;
}

export function mediaHref(filters: MediaFilters, page = 1): Route {
  return withQuery(MEDIA_PATH, { q: filters.q, page: page > 1 ? page : undefined });
}

export interface MediaLibraryViewProps {
  list: MediaListResponse;
  filters: MediaFilters;
  /** settings.manage: upload, describe and delete (the API checks again). */
  canManage: boolean;
  csrf: CsrfInput;
}

/**
 * The store's reusable pictures (store logo, sharing image, SEO and onboarding images):
 * a searchable grid, uploads with progress, descriptions, the key to paste into an image
 * field, and deletes the API refuses while a picture is still in use.
 */
export function MediaLibraryView({ list, filters, canManage, csrf }: MediaLibraryViewProps) {
  return (
    <div className="grid gap-6">
      <PageToolbar
        icon={Images}
        title="Media library"
        description="Pictures the store reuses outside the catalog: the store logo and sharing image, SEO images and onboarding slides. Choose one from the picker beside the store logo, sharing image, SEO or onboarding field, or copy its key into a field that takes one."
        meta={<span><CountText count={list.total} one="picture" /></span>}
      />

      {canManage ? (
        <SectionCard title="Upload" icon={Upload} className="nz-panel-strong">
          <MediaUploader csrf={csrf} />
        </SectionCard>
      ) : (
        <ViewOnly>
          Your account can browse the library and copy keys. Uploading, describing and deleting
          pictures needs the “Manage store settings” permission.
        </ViewOnly>
      )}

      <section
        aria-label="Pictures"
        className="nz-panel-strong nz-panel-sheen grid gap-5 rounded-2xl border p-4 sm:p-5"
      >
        <FilterBar
          action={MEDIA_PATH}
          label="Search the media library"
          resetHref={filters.q ? MEDIA_PATH : undefined}
        >
          <SearchFilter label="Search" defaultValue={filters.q} placeholder="Description or file name" />
        </FilterBar>
        {filters.q ? (
          <FilterChips
            chips={[{ key: 'q', label: `Search: ${filters.q}`, removeHref: MEDIA_PATH }]}
          />
        ) : null}

        {list.assets.length === 0 ? (
          <EmptyPanel
            icon={filters.q ? SearchX : Images}
            title={filters.q ? 'No pictures match this search' : 'The library is empty'}
            description={
              filters.q
                ? 'Try another word from a description or file name.'
                : canManage
                  ? 'Upload the store logo, a sharing image or onboarding pictures to reuse them.'
                  : 'Pictures appear here once someone with the “Manage store settings” permission uploads them.'
            }
            className="py-14"
          />
        ) : (
          <ul aria-label="Library pictures" className="nz-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {list.assets.map((asset) => (
              <li key={asset.id} className="grid content-start gap-3 rounded-2xl border border-hairline bg-panel p-3">
                <div className="aspect-4/3 overflow-hidden rounded-xl bg-neutral-soft">
                  {/* eslint-disable-next-line @next/next/no-img-element -- served from the media origin, unknown at build time */}
                  <img
                    src={asset.thumbUrl}
                    alt={asset.alt ?? ''}
                    width={asset.width}
                    height={asset.height}
                    loading="lazy"
                    decoding="async"
                    className="size-full object-contain"
                  />
                </div>
                <div className="grid gap-0.5">
                  <p className="truncate text-sm font-medium text-foreground" title={asset.originalName ?? undefined}>
                    {asset.originalName ?? 'Untitled picture'}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {asset.width} × {asset.height} px · {formatBytes(asset.bytes)} · added{' '}
                    <DateTimeText value={asset.createdAt} />
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground"><AutoText value={asset.key} /></p>
                </div>
                {canManage ? (
                  <MediaAssetControls asset={asset} csrf={csrf} />
                ) : (
                  <div className="flex flex-wrap gap-2 border-t border-hairline pt-3">
                    <CopyButton value={asset.key} label="Copy key" />
                    <CopyButton value={asset.url} label="Copy URL" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {list.total > 0 ? (
          <Pagination
            page={list.page}
            totalPages={list.totalPages}
            total={list.total}
            pageSize={list.pageSize}
            noun="pictures"
            hrefFor={(page) => mediaHref(filters, page)}
          />
        ) : null}
      </section>
    </div>
  );
}
