'use client';

import type { AdminShoppingZone } from '@nilzora/contracts';
import { Alert, Button, cn } from '@nilzora/ui';
import Link from 'next/link';
import { useActionState, useId, useState } from 'react';
import type { ActionState } from '@/components/admin-kit/act';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { setCategoryZonesAction, setProductZonesAction } from '@/lib/zone-actions';
import { AutoText } from '@/components/i18n/translate';

/*
 * Shopping zone assignment from the record's own page.
 *
 * The zone editor writes the same junction rows from the other side. The one thing this form
 * must get right is the product rule: a product with zones of its own ignores its category's
 * zones, and a product without any follows its category. So the control is not a plain
 * multi-select — it first asks which of those two situations applies, and shows what the
 * category currently gives the product so the choice is informed.
 */

const IDLE: ActionState = { status: 'idle' };

function Outcome({ state }: { state: ActionState }) {
  if (state.status === 'idle' || !state.message) return null;
  return (
    <Alert tone={state.status === 'success' ? 'success' : 'danger'}>
      <span aria-live="polite"><AutoText value={state.message} /></span>
    </Alert>
  );
}

interface ZoneChoiceProps {
  zones: readonly AdminShoppingZone[];
  selected: readonly string[];
  onChange: (zoneId: string, on: boolean) => void;
  /** Ticks a zone the record does not have yet (product: inherited; category: none). */
  hintFor?: (zoneId: string) => string | undefined;
}

function ZoneChoices({ zones, selected, onChange, hintFor }: ZoneChoiceProps) {
  if (zones.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        There are no shopping zones yet.{' '}
        <Link className="text-link underline-offset-4 hover:underline" href="/admin/zones"><AutoText>Create the first one</AutoText></Link>{' '}
        to group products this way.
      </p>
    );
  }
  return (
    <ul role="list" className="divide-y divide-hairline rounded-xl ring-1 ring-hairline">
      {zones.map((zone) => {
        const on = selected.includes(zone.id);
        const hint = hintFor?.(zone.id);
        return (
          <li key={zone.id}>
            <label className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-3 px-4 py-3 transition-colors hover:bg-info-soft/40">
              <input
                type="checkbox"
                name="zoneIds"
                value={zone.id}
                checked={on}
                onChange={(event) => onChange(zone.id, event.currentTarget.checked)}
                className="mt-0.5 size-5 accent-primary-action"
              />
              <span className="grid min-w-0 gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground"><AutoText value={zone.name} /></span>
                  {zone.isActive ? null : (
                    <span className="text-xs font-medium text-muted-foreground">hidden</span>
                  )}
                  {hint ? <span className="text-xs font-medium text-moderator"><AutoText value={hint} /></span> : null}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  /products?zone={zone.slug} · {zone.productCount}{' '}
                  {zone.productCount === 1 ? 'product' : 'products'} now
                </span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

/** Which of the two product states applies: follow the category, or use the product's own. */
export function ProductZoneForm({
  productId,
  zones,
  mine,
  inherited,
  csrf,
}: {
  productId: string;
  zones: readonly AdminShoppingZone[];
  /** Zones pinned to this product. */
  mine: readonly string[];
  /** Zones of the product's category (what it inherits while nothing is pinned). */
  inherited: readonly string[];
  csrf: CsrfInput;
}) {
  const [state, action, pending] = useActionState(setProductZonesAction, IDLE);
  const [mode, setMode] = useState<'inherit' | 'own'>(mine.length > 0 ? 'own' : 'inherit');
  const [chosen, setChosen] = useState<readonly string[]>([...mine]);
  const id = useId();

  const inheritedNames = zones
    .filter((zone) => inherited.includes(zone.id))
    .map((zone) => zone.name);
  // The state a shopper gets right now, spelled out: pinned zones, else the category's.
  const resolvedNames = (mode === 'own' ? chosen : inherited)
    .map((zoneId) => zones.find((zone) => zone.id === zoneId)?.name)
    .filter((name): name is string => name !== undefined);

  return (
    <form action={action} className="grid gap-4">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="mode" value={mode} />
      <Outcome state={state} />

      <fieldset className="grid gap-2">
        <legend className="text-xs font-semibold text-muted-foreground"><AutoText>Where this product goes</AutoText></legend>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl p-2 ring-1 ring-hairline has-checked:ring-primary">
          <input
            type="radio"
            name={`${id}-mode`}
            checked={mode === 'inherit'}
            onChange={() => setMode('inherit')}
            className="mt-1 size-4 accent-primary-action"
          />
          <span className="grid gap-0.5">
            <span className="text-sm font-medium text-foreground"><AutoText>Follow the category</AutoText></span>
            <span className="text-xs text-muted-foreground">
              {inheritedNames.length > 0
                ? `Inherits ${inheritedNames.join(', ')} from ${'its category'}.`
                : 'Its category feeds no collection, so it only appears in general browsing.'}
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl p-2 ring-1 ring-hairline has-checked:ring-primary">
          <input
            type="radio"
            name={`${id}-mode`}
            checked={mode === 'own'}
            onChange={() => setMode('own')}
            className="mt-1 size-4 accent-primary-action"
          />
          <span className="grid gap-0.5">
            <span className="text-sm font-medium text-foreground"><AutoText>Choose this product’s zones</AutoText></span>
            <span className="text-xs text-muted-foreground"><AutoText>Pinned zones win: the category’s collections are ignored for this product.</AutoText></span>
          </span>
        </label>
      </fieldset>

      {mode === 'own' ? (
        <ZoneChoices
          zones={zones}
          selected={chosen}
          onChange={(zoneId, on) =>
            setChosen((current) =>
              on ? [...current, zoneId] : current.filter((value) => value !== zoneId),
            )
          }
                    hintFor={(zoneId) => (inherited.includes(zoneId) ? 'from the category' : undefined)}
                  />
      ) : inherited.length > 0 ? (
        <ul role="list" className="grid gap-1 rounded-xl bg-surface-muted/40 p-3 text-sm">
          {inheritedNames.map((name) => (
            <li key={name} className="text-muted-foreground">
              {name}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {resolvedNames.length > 0
          ? `Shoppers find it under ${resolvedNames.join(', ')}.`
          : 'Shoppers find it through the categories only.'}
      </p>

      <div className="flex justify-end">
        <Button
          type="submit"
          loading={pending}
          disabled={mode === 'own' && chosen.length === 0}
          className="max-sm:min-h-11 max-sm:w-full"
        ><AutoText>Save zones</AutoText></Button>
      </div>
    </form>
  );
}

/** The zones a category feeds. Empty is a normal state: the category feeds none. */
export function CategoryZoneForm({
  categoryId,
  zones,
  selected,
  csrf,
}: {
  categoryId: string;
  zones: readonly AdminShoppingZone[];
  selected: readonly string[];
  csrf: CsrfInput;
}) {
  const [state, action, pending] = useActionState(setCategoryZonesAction, IDLE);
  const [chosen, setChosen] = useState<readonly string[]>([...selected]);

  return (
    <form action={action} className="grid gap-4">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="categoryId" value={categoryId} />
      <Outcome state={state} />
      <p className="text-sm text-muted-foreground">
        Every product in this category appears in these collections, unless it has zones of its
        own.
      </p>
      <ZoneChoices
        zones={zones}
        selected={chosen}
        onChange={(zoneId, on) =>
          setChosen((current) =>
            on ? [...current, zoneId] : current.filter((value) => value !== zoneId),
          )
        }
      />
      <div className="flex items-center justify-between gap-3">
        <span className={cn('text-xs text-muted-foreground')}>
          {chosen.length === 0 ? 'Feeds no collection.' : `${String(chosen.length)} selected.`}
        </span>
        <Button type="submit" loading={pending} className="max-sm:min-h-11"><AutoText>Save zones</AutoText></Button>
      </div>
    </form>
  );
}
