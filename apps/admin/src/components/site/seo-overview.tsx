import type { SeoOverviewRow } from '@nilzora/contracts';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nilzora/ui';
import { Search } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { Chip, DataTable, DataTableEmpty, FilterBar, SearchFilter } from '@/components/admin-kit';
import { SectionCard } from '@/components/admin-kit/section-card';
import { seoEditorPath } from './site-rules';
import { AutoText } from '@/components/i18n/translate';
import { DateTimeText } from '@/components/i18n/format-text';

export const SEO_PATH = '/admin/seo' as Route;

/** The address of a page's metadata editor (the route takes the singular kind). */
export function seoEditorHref(entry: Pick<SeoOverviewRow, 'kind' | 'id'>): Route {
  return seoEditorPath(entry.kind, entry.id) as Route;
}

/** How each page's search metadata stands: only what is set, no score and no ranking claim. */
export function SeoOverviewView({ entries, q }: { entries: readonly SeoOverviewRow[]; q: string }) {
  const publicCount = entries.filter((entry) => entry.isPublic).length;
  const missingTitle = entries.filter((entry) => entry.isPublic && entry.missingTitle).length;
  const missingDescription = entries.filter(
    (entry) => entry.isPublic && entry.missingDescription,
  ).length;
  const noIndexed = entries.filter((entry) => entry.isPublic && entry.noIndex).length;

  return (
    <SectionCard
      title={`Pages (${String(entries.length)})`}
      icon={Search}
      description={`${String(publicCount)} public · ${String(missingTitle)} without a search title · ${String(missingDescription)} without a search description · ${String(noIndexed)} hidden from search`}
      className="nz-panel-strong"
      flush
    >
      <div className="grid gap-4 border-b border-hairline px-5 pb-4 sm:px-6">
        <FilterBar
          action={SEO_PATH}
          label="Search pages"
          resetHref={q === '' ? undefined : SEO_PATH}
        >
          <SearchFilter label="Search" defaultValue={q} placeholder="Name or slug" />
        </FilterBar>
      </div>
      <div className="nz-sticky-head lg:[&>div]:max-h-[min(72vh,52rem)] lg:[&>div]:overflow-y-auto">
        <DataTable caption="Search metadata by page" dense>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>
                <AutoText>Page</AutoText>
              </TableHead>
              <TableHead>
                <AutoText>Kind</AutoText>
              </TableHead>
              <TableHead>
                <AutoText>Search title</AutoText>
              </TableHead>
              <TableHead>
                <AutoText>Indexed</AutoText>
              </TableHead>
              <TableHead className="hidden md:table-cell">
                <AutoText>Updated</AutoText>
              </TableHead>
            </TableRow>
          </TableHeader>
          {entries.length > 0 ? (
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={`${entry.kind}-${entry.id}`}>
                  <TableCell>
                    <Link
                      href={seoEditorHref(entry)}
                      className="font-medium text-foreground underline-offset-4 hover:text-link hover:underline"
                    >
                      {entry.name}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">/{entry.slug}</p>
                  </TableCell>
                  <TableCell className="capitalize">
                    <AutoText value={entry.kind} />
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-normal">
                    {entry.seoTitle ?? (
                      <Chip tone="warning">{`Missing — the ${entry.kind} name is used`}</Chip>
                    )}
                  </TableCell>
                  <TableCell>
                    {!entry.isPublic ? (
                      <Chip tone="neutral">
                        <AutoText>Not public</AutoText>
                      </Chip>
                    ) : entry.noIndex ? (
                      <Chip tone="warning">
                        <AutoText>Hidden</AutoText>
                      </Chip>
                    ) : (
                      <Chip tone="success" dot>
                        <AutoText>Indexable</AutoText>
                      </Chip>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    <DateTimeText value={entry.updatedAt} style="datetime" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          ) : (
            <DataTableEmpty
              colSpan={5}
              icon={Search}
              title="No pages match this view."
              description={
                q === ''
                  ? 'Products and categories appear here once they exist.'
                  : 'Try another name or slug.'
              }
            />
          )}
        </DataTable>
      </div>
    </SectionCard>
  );
}
