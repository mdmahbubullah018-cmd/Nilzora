'use client';

import { LOW_STOCK_THRESHOLD } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { Eye, ImageOff, Ruler, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { SectionCard } from '@/components/admin-kit/section-card';
import { formatMoney } from '@/lib/format';
import { useProductForm } from './product-editor';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * A live preview of the product as shoppers will see it, before saving: the listing card and
 * the top of the product page. It reads the form's own fields (the inputs carry `form=`, so
 * FormData on the form element sees them) and redraws on every edit. A field the account may
 * not change right now is not in the form, so the preview shows its saved value instead. It
 * changes nothing and sends nothing; the saved product is still whatever the server accepts.
 */

/** The saved product, for fields that are read-only (not in the form) right now. */
export interface PreviewSaved {
  name: string;
  summary: string;
  price: string;
  compareAtPrice: string;
  category: string;
  isFeatured: boolean;
}

/** Facts the form does not edit, shown as shoppers will see them. */
export interface PreviewFacts {
  /** Units on hand now; null on the create form (the opening stock field is read instead). */
  stockQuantity: number | null;
  /** Variants on sale; shoppers then choose an option before buying. */
  variantCount: number;
  /** Whether the saved product has a size chart, for when the chart is not in the form. */
  hasSizeChart?: boolean;
}

interface Draft {
  name: string;
  summary: string;
  price: number | null;
  compareAt: number | null;
  category: string;
  featured: boolean;
  stock: number | null;
  hasSizeChart: boolean;
}

function taka(text: string): number | null {
  const value = Number(text.replace(/[৳,\s]/g, '').trim());
  return text.trim() !== '' && Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
}

const EMPTY_SAVED: PreviewSaved = {
  name: '',
  summary: '',
  price: '',
  compareAtPrice: '',
  category: '',
  isFeatured: false,
};

export function readDraft(
  form: HTMLFormElement | null,
  saved: PreviewSaved,
  facts: PreviewFacts,
): Draft {
  const data = form ? new FormData(form) : new FormData();
  const doc = form?.ownerDocument;
  const field = <T extends Element>(name: string) =>
    form && doc ? doc.querySelector<T>(`[name="${name}"][form="${form.id}"]`) : null;
  /** The field's text, or the saved value when the field is not part of the form. */
  const text = (name: string, fallback: string) => {
    const value = data.get(name);
    return typeof value === 'string' ? value.trim() : fallback;
  };
  // The category picker's selects (one per level, see category-picker.tsx): the deepest one the
  // admin has chosen names the category. They change the instant the admin picks, before any
  // re-render, which is why the preview reads them rather than the hidden id field.
  const levels =
    form && doc
      ? Array.from(
          doc.querySelectorAll<HTMLSelectElement>(`select[data-category-level][form="${form.id}"]`),
        )
      : [];
  const chosen = [...levels].reverse().find((level) => level.value !== '');
  const featured = field<HTMLInputElement>('isFeatured');
  const opening = data.get('initialStock');
  const chart = data.get('sizeChart');
  return {
    name: text('name', saved.name),
    summary: text('summary', saved.summary),
    price: taka(text('price', saved.price)),
    compareAt: taka(text('compareAtPrice', saved.compareAtPrice)),
    category:
      levels.length > 0 ? (chosen?.selectedOptions[0]?.textContent?.trim() ?? '') : saved.category,
    featured: featured ? featured.checked : saved.isFeatured,
    stock:
      facts.stockQuantity ??
      (typeof opening === 'string' && /^\d+$/.test(opening.trim()) ? Number(opening.trim()) : 0),
    hasSizeChart: typeof chart === 'string' ? chart.trim() !== '' : facts.hasSizeChart === true,
  };
}

function StockLine({ stock, variantCount }: { stock: number | null; variantCount: number }) {
  if (stock === null) return null;
  const tone =
    stock === 0
      ? 'text-danger-ink'
      : stock <= LOW_STOCK_THRESHOLD
        ? 'text-warning-ink'
        : 'text-success-ink';
  const label =
    stock === 0 ? 'Out of stock' : stock <= LOW_STOCK_THRESHOLD ? 'Only a few left' : 'In stock';
  return (
    <p className={cn('text-xs font-medium', tone)}>
      {label}
      {variantCount > 0 ? (
        <span className="font-normal text-muted-foreground">
          {' '}
          · {variantCount === 1 ? '1 option' : `${String(variantCount)} options`} to choose from
        </span>
      ) : null}
    </p>
  );
}

export function ProductPreview({
  coverUrl,
  saved = EMPTY_SAVED,
  facts = { stockQuantity: null, variantCount: 0 },
}: {
  coverUrl: string | null;
  saved?: PreviewSaved;
  facts?: PreviewFacts;
}) {
  const tx = useTx();
  const { formId } = useProductForm();
  const [draft, setDraft] = useState<Draft>(() => readDraft(null, saved, facts));
  const savedKey = JSON.stringify(saved);
  const factsKey = JSON.stringify(facts);

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    const currentSaved = JSON.parse(savedKey) as PreviewSaved;
    const currentFacts = JSON.parse(factsKey) as PreviewFacts;
    const update = () => {
      setDraft(readDraft(form, currentSaved, currentFacts));
    };
    update();
    // The size chart and tags change without an input event on a form field; look again
    // shortly after any click inside the page as well.
    let timer: number | undefined;
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 0);
    };
    const onEdit = (event: Event) => {
      const target = event.target as { form?: HTMLFormElement | null } | null;
      if (target?.form?.id === formId) update();
    };
    document.addEventListener('input', onEdit);
    document.addEventListener('change', onEdit);
    document.addEventListener('click', later);
    return () => {
      document.removeEventListener('input', onEdit);
      document.removeEventListener('change', onEdit);
      document.removeEventListener('click', later);
      window.clearTimeout(timer);
    };
  }, [formId, savedKey, factsKey]);

  const onSale = draft.price !== null && draft.compareAt !== null && draft.compareAt > draft.price;
  const off =
    onSale && draft.price !== null && draft.compareAt !== null
      ? Math.round(((draft.compareAt - draft.price) / draft.compareAt) * 100)
      : 0;
  const soldOut = draft.stock === 0;

  return (
    <SectionCard
      title={tx("Preview")}
      icon={Eye}
      description={tx("How shoppers will see it, as you type. Nothing is saved until you save.")}
    >
      {/* Side by side only when the card itself is wide (the create form keeps it in a narrow column). */}
      <div className="@container">
        <div className="grid gap-5 @lg:grid-cols-[12rem_minmax(0,1fr)]">
          <div
            aria-label={tx("Listing card preview")}
            className="overflow-hidden rounded-2xl border border-hairline bg-surface"
          >
            <div className="relative grid aspect-square place-items-center bg-surface-muted">
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a preview of an uploaded picture
                <img
                  src={coverUrl}
                  alt=""
                  className={cn('size-full object-cover', soldOut && 'opacity-60 grayscale')}
                />
              ) : (
                <span className="grid justify-items-center gap-1 text-center text-xs text-muted-foreground">
                  <ImageOff aria-hidden="true" className="size-8" /><AutoText>No picture yet</AutoText></span>
              )}
              <span className="absolute top-2 left-2 flex flex-wrap gap-1">
                {off > 0 ? (
                  <span className="rounded-full bg-offer px-2 py-0.5 text-[11px] font-bold text-white">
                    −{off}%
                  </span>
                ) : null}
                {draft.featured ? (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-brand-navy px-2 py-0.5 text-[11px] font-semibold text-white">
                    <Star aria-hidden="true" className="size-3" strokeWidth={2} /><AutoText>Featured</AutoText></span>
                ) : null}
              </span>
            </div>
            <div className="grid gap-1 p-3">
              <p
                className={cn(
                  'line-clamp-2 text-sm font-medium',
                  draft.name ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {draft.name || 'Product name'}
              </p>
              <p className="flex items-baseline gap-1.5">
                <span className="text-sm font-semibold text-foreground">
                  {draft.price === null ? '৳ —' : formatMoney(draft.price)}
                </span>
                {onSale && draft.compareAt !== null ? (
                  <span className="text-xs text-muted-foreground line-through">
                    {formatMoney(draft.compareAt)}
                  </span>
                ) : null}
              </p>
              <StockLine stock={draft.stock} variantCount={facts.variantCount} />
            </div>
          </div>

          <div aria-label={tx("Product page preview")} className="grid content-start gap-2">
            {draft.category ? (
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {draft.category}
              </p>
            ) : null}
            <p
              className={cn(
                'font-display text-xl font-semibold',
                draft.name ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {draft.name || 'Product name'}
            </p>
            <p className="text-sm text-muted-foreground">
              {draft.summary || 'A one-line summary appears here.'}
            </p>
            {draft.price !== null ? (
              <p className="flex flex-wrap items-baseline gap-2">
                <span className="text-lg font-semibold text-foreground tabular-nums">
                  {formatMoney(draft.price)}
                </span>
                {onSale && draft.compareAt !== null ? (
                  <>
                    <span className="text-sm text-muted-foreground line-through tabular-nums">
                      {formatMoney(draft.compareAt)}
                    </span>
                    <span className="text-xs font-semibold text-offer-ink">Save {off}%</span>
                  </>
                ) : null}
              </p>
            ) : (
              <p className="text-sm text-warning-ink"><AutoText>Enter a price to see it.</AutoText></p>
            )}
            {draft.compareAt !== null && draft.price !== null && draft.compareAt <= draft.price ? (
              <p className="text-sm text-warning-ink"><AutoText>The former price must be higher than the price to show a sale.</AutoText></p>
            ) : null}
            {draft.hasSizeChart ? (
              <p className="inline-flex items-center gap-1.5 text-sm font-medium text-link">
                <Ruler aria-hidden="true" className="size-4" strokeWidth={1.75} /><AutoText>Size guide shown on the product page</AutoText></p>
            ) : null}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
