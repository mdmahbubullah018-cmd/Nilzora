'use client';

import type { MenuItem, MenuName } from '@nilzora/contracts';
import { Button, Field, Input } from '@nilzora/ui';
import { ChevronDown, ChevronUp, Link2, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { useActionState, useState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { Chip } from '@/components/admin-kit/chip';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { SectionCard } from '@/components/admin-kit/section-card';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { EmptyPanel } from '@/components/catalog/catalog-ui';
import {
  deleteMenuItemAction,
  moveMenuItemAction,
  saveMenuItemAction,
} from '@/lib/content-actions';
import {
  checkMenuItem,
  MENU_LABELS,
  MENU_MAX_ITEMS,
  MENU_NAMES,
  type FieldErrors,
} from './content-rules';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

const TOUCH = 'max-sm:h-11';

/** Adds a link to a menu, or edits one. The label and the link are checked as they are sent. */
export function MenuItemForm({
  menu,
  item,
  csrf,
  onDone,
}: {
  menu: MenuName;
  item?: MenuItem;
  csrf: CsrfInput;
  onDone?: () => void;
}) {
  const tx = useTx();
  const [state, action] = useActionState(saveMenuItemAction, IDLE_STATE);
  const [errors, setErrors] = useState<FieldErrors>({});
  const id = item?.id ?? `new-${menu}`;
  const error = (field: string) =>
    errors[field] ?? (state.status === 'error' ? state.fieldErrors?.[field] : undefined);
  const values = state.status === 'error' ? state.values : undefined;

  return (
    <form
      action={action}
      noValidate
      onSubmit={(event) => {
        const data = new FormData(event.currentTarget);
        const text = (name: string) => {
          const value = data.get(name);
          return typeof value === 'string' ? value : '';
        };
        const checked = checkMenuItem(
          { menu, label: text('label'), href: text('href') },
          data.has('isActive'),
        );
        if (checked.ok) {
          setErrors({});
          return;
        }
        event.preventDefault();
        setErrors(checked.errors);
      }}
      className="grid gap-4"
    >
      <CsrfField csrf={csrf} />
      <input type="hidden" name="menu" value={menu} />
      {item ? <input type="hidden" name="itemId" value={item.id} /> : null}
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field id={`label-${id}`} label={tx("Label")} required error={error('label')} hint={tx("Up to 40 characters.")}>
          {(control) => (
            <Input
              {...control}
              name="label"
              maxLength={40}
              defaultValue={values?.label ?? item?.label ?? ''}
              className={TOUCH}
            />
          )}
        </Field>
        <Field
          id={`href-${id}`}
          label={tx("Link")}
          required
          error={error('href')}
          hint={tx("A store path such as /products, or an https address.")}
        >
          {(control) => (
            <Input
              {...control}
              name="href"
              maxLength={300}
              autoCapitalize="none"
              spellCheck={false}
              defaultValue={values?.href ?? item?.href ?? ''}
              className={`font-mono ${TOUCH}`}
            />
          )}
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-2.5 text-sm text-foreground">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={item?.isActive ?? true}
          className="size-5 accent-primary-action"
        /><AutoText>Show this link on the storefront</AutoText></label>
      <ActionFeedback state={state} />
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pendingLabel="Saving…" className="max-sm:min-h-11">
          {item ? (
            <Save aria-hidden="true" strokeWidth={1.75} />
          ) : (
            <Plus aria-hidden="true" strokeWidth={1.75} />
          )}
          {item ? 'Save link' : 'Add link'}
        </SubmitButton>
        {onDone ? (
          <Button type="button" variant="ghost" onClick={onDone} className="max-sm:min-h-11"><AutoText>Close</AutoText></Button>
        ) : null}
      </div>
    </form>
  );
}

function MenuRow({
  item,
  menu,
  order,
  index,
  count,
  csrf,
}: {
  item: MenuItem;
  menu: MenuName;
  /** Every link of the menu, in the order shown. */
  order: string;
  index: number;
  count: number;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [editing, setEditing] = useState(false);
  const [moveState, move, moving] = useActionState(moveMenuItemAction, IDLE_STATE);
  const [deleteState, remove] = useActionState(deleteMenuItemAction, IDLE_STATE);
  return (
    <li className="grid gap-3 px-5 py-3.5 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <form action={move} className="flex shrink-0 gap-1.5">
          <CsrfField csrf={csrf} />
          <input type="hidden" name="menu" value={menu} />
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="order" value={order} />
          <Button
            type="submit"
            name="direction"
            value="earlier"
            variant="outline"
            size="sm"
            disabled={index === 0 || moving}
            aria-label={`Move ${item.label} earlier`}
            className="rounded-xl max-sm:size-11"
          >
            <ChevronUp aria-hidden="true" strokeWidth={1.75} />
          </Button>
          <Button
            type="submit"
            name="direction"
            value="later"
            variant="outline"
            size="sm"
            disabled={index === count - 1 || moving}
            aria-label={`Move ${item.label} later`}
            className="rounded-xl max-sm:size-11"
          >
            <ChevronDown aria-hidden="true" strokeWidth={1.75} />
          </Button>
        </form>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
            {item.label}
            {item.isActive ? null : <Chip tone="neutral"><AutoText>Hidden</AutoText></Chip>}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground"><AutoText value={item.href} /></p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={editing}
            onClick={() => setEditing((value) => !value)}
            className="rounded-xl max-sm:min-h-11"
          >
            <Pencil aria-hidden="true" strokeWidth={1.75} />
            Edit{' '}<span className="sr-only"><AutoText value={item.label} /></span>
          </Button>
          <ConfirmForm
            action={remove}
            csrf={csrf}
            align="end"
            triggerVariant="ghost"
            trigger={
              <>
                <Trash2 aria-hidden="true" strokeWidth={1.75} />
                Remove{' '}<span className="sr-only"><AutoText value={item.label} /></span>
              </>
            }
            title={`Remove “${item.label}” from the menu?`}
            description={tx("The link disappears from the storefront. The page it pointed to is not deleted.")}
            confirmLabel={tx("Remove link")}
            hiddenFields={{ itemId: item.id }}
            error={deleteState.status === 'error' ? deleteState.message : undefined}
          />
        </div>
      </div>
      {moveState.status === 'error' ? <ActionFeedback state={moveState} inline /> : null}
      {editing ? (
        <div className="rounded-xl border border-hairline bg-neutral-soft/40 p-4">
          <MenuItemForm menu={menu} item={item} csrf={csrf} onDone={() => setEditing(false)} />
        </div>
      ) : null}
    </li>
  );
}

/** The storefront's three menus: each link can be added, edited, hidden, removed and reordered. */
export function MenusView({ items, csrf }: { items: readonly MenuItem[]; csrf: CsrfInput }) {
  const tx = useTx();
  return (
    <div className="grid gap-6">
      {MENU_NAMES.map((menu) => {
        const links = items.filter((item) => item.menu === menu).sort((a, b) => a.sortOrder - b.sortOrder);
        const order = links.map((link) => link.id).join(',');
        const full = links.length >= MENU_MAX_ITEMS;
        return (
          <SectionCard
            key={menu}
            title={MENU_LABELS[menu].title}
            icon={Link2}
            description={`${MENU_LABELS[menu].description} ${String(links.length)} of ${String(MENU_MAX_ITEMS)} links.`}
            className="nz-panel-strong"
            flush
          >
            {links.length === 0 ? (
              <EmptyPanel
                icon={Link2}
                title={tx("No links yet")}
                description={tx("Without links, the storefront keeps its built-in menu.")}
                className="py-8"
              />
            ) : (
              <ul
                aria-label={`${MENU_LABELS[menu].title} links`}
                className="divide-y divide-hairline border-t border-hairline"
              >
                {links.map((link, index) => (
                  <MenuRow
                    key={link.id}
                    item={link}
                    menu={menu}
                    order={order}
                    index={index}
                    count={links.length}
                    csrf={csrf}
                  />
                ))}
              </ul>
            )}
            <div className="border-t border-hairline px-5 py-4 sm:px-6">
              {full ? (
                <p className="text-sm text-muted-foreground">
                  This menu holds {MENU_MAX_ITEMS} links, the most it can. Remove one to add another.
                </p>
              ) : (
                <details className="group">
                  <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-link ring-1 ring-hairline hover:bg-info-soft/50 max-sm:min-h-11 [&::-webkit-details-marker]:hidden">
                    <Plus aria-hidden="true" className="size-4" strokeWidth={1.75} />
                    Add a link{' '}<span className="sr-only">to the {MENU_LABELS[menu].title}</span>
                  </summary>
                  <div className="mt-4">
                    <MenuItemForm menu={menu} csrf={csrf} />
                  </div>
                </details>
              )}
            </div>
          </SectionCard>
        );
      })}
    </div>
  );
}
