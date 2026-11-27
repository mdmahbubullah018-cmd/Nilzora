'use client';

import type { ProductVariant } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  choose,
  offered,
  requirementName,
  type AttributeGroup,
  type Selection,
} from './variant-selection';

/*
 * The option pickers (a chip per size, a swatch per colour) shared by the product page and the
 * quick-add sheet. It owns the markup and the rules for which values can be picked; the
 * caller owns the selection, so each can decide what else a pick should do.
 */

export interface VariantOptionsProps {
  variants: readonly ProductVariant[];
  groups: readonly AttributeGroup[];
  selected: Selection;
  /** Called with the new selection after a value is picked. */
  onSelect: (next: Selection, group: AttributeGroup, valueSlug: string) => void;
  /** Prefix of the element ids, so two pickers on one page never share an id. */
  idPrefix?: string;
  /** Show the "Choose a size" line under every attribute that still needs an answer. */
  showRequired?: boolean;
  /** The word the line starts with: the product page says "Choose", the sheet "Select". */
  requiredVerb?: 'Choose' | 'Select';
  /** The customer tried to continue without choosing: outline what is missing. */
  invalid?: boolean;
  /** Shown after the attributes, inside the same fieldset (e.g. a size guide link). */
  children?: ReactNode;
}

export function VariantOptions({
  variants,
  groups,
  selected,
  onSelect,
  idPrefix = 'option',
  showRequired = true,
  requiredVerb = 'Choose',
  invalid = false,
  children,
}: VariantOptionsProps) {
  return (
    <fieldset className="grid gap-4">
      <legend className="sr-only">Choose your options</legend>
      {groups.map((group) => {
        const chosenValue = group.values.find(
          (value) => value.slug === selected[group.slug],
        )?.value;
        const required = selected[group.slug] === undefined;
        const flagged = required && invalid;
        const labelId = `${idPrefix}-${group.slug}`;
        const requiredId = `${idPrefix}-${group.slug}-required`;
        return (
          <div
            key={group.slug}
            data-invalid={flagged ? 'true' : undefined}
            className={cn(
              'grid gap-2',
              flagged && 'rounded-xl outline-2 outline-offset-4 outline-danger-line',
            )}
          >
            <p id={labelId} className="text-sm font-medium text-foreground">
              <span>{group.name}</span>
              {chosenValue === undefined ? null : (
                <span className="font-normal text-muted-foreground"> · {chosenValue}</span>
              )}
            </p>
            {required && showRequired ? (
              <p
                id={requiredId}
                role={flagged ? 'alert' : undefined}
                className={cn('text-xs font-semibold', flagged ? 'text-red-700' : 'text-primary')}
              >
                {requiredVerb} a {requirementName(group)}
              </p>
            ) : null}
            <div
              role="group"
              aria-labelledby={labelId}
              aria-describedby={required && showRequired ? requiredId : undefined}
              className="flex flex-wrap gap-1.5"
            >
              {group.values.map((value) => {
                const isSelected = selected[group.slug] === value.slug;
                // Sold next to the other choices at all, and still in stock there.
                const sold = offered(variants, groups, selected, group.slug, value.slug, {
                  inStock: false,
                });
                const available =
                  sold &&
                  offered(variants, groups, selected, group.slug, value.slug, {
                    inStock: true,
                  });
                const note = available ? null : sold ? 'Sold out' : 'not with this choice';
                const swatch = group.kind === 'color' ? value.swatchHex : null;
                const pick = () => {
                  // A sold-out option (a real combination with no stock) stays visible but
                  // cannot become the selection. A value merely not sold with the current
                  // choice may be picked: it re-scopes the other choices instead.
                  if (sold && !available && !isSelected) return;
                  onSelect(choose(variants, selected, group.slug, value.slug), group, value.slug);
                };
                if (swatch) {
                  return (
                    <button
                      key={value.slug}
                      type="button"
                      aria-pressed={isSelected}
                      aria-label={`${value.value}${note === null ? '' : `, ${note}`}`}
                      aria-disabled={!available && !isSelected}
                      title={note ?? value.value}
                      onClick={pick}
                      className={cn(
                        // A compact disc: 32px keeps a whole row of colours on one line, and
                        // the chosen one is marked with a navy edge and ring, not a bigger dot.
                        // The pseudo-element below keeps the 44px touch target around it.
                        'relative grid size-8 place-items-center rounded-full border transition-all',
                        "after:absolute after:-inset-1.5 after:content-['']",
                        isSelected
                          ? 'border-brand-navy ring-1 ring-brand-navy/40 ring-offset-1 ring-offset-surface'
                          : 'border-border-strong hover:border-brand-navy',
                        !available && !isSelected && 'opacity-35 saturate-50',
                      )}
                      style={{ backgroundColor: swatch }}
                    >
                      {isSelected ? (
                        <Check aria-hidden="true" className="size-3.5 text-white drop-shadow" />
                      ) : null}
                      {note !== null && !isSelected ? (
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute -inset-0.5 rounded-full border border-dashed border-danger-line"
                        />
                      ) : null}
                      <span className="sr-only">{value.value}</span>
                    </button>
                  );
                }
                return (
                  <button
                    key={value.slug}
                    type="button"
                    aria-pressed={isSelected}
                    aria-disabled={!available && !isSelected}
                    onClick={pick}
                    className={cn(
                      // 44px minimum stays: this is a size chip, and a touch target is not a
                      // place to save space. Only the colour swatches got smaller.
                      'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors',
                      isSelected
                        ? 'border-brand-navy bg-brand-navy text-brand-soft'
                        : 'border-border-strong bg-surface text-foreground hover:border-brand-navy',
                      !available && !isSelected && 'opacity-40',
                    )}
                  >
                    {isSelected ? <Check aria-hidden="true" className="size-3" /> : null}
                    {value.value}
                    {note !== null && !isSelected ? (
                      <span className="text-xs font-normal">({note})</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {children}
    </fieldset>
  );
}
