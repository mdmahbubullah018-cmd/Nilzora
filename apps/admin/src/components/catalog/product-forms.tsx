'use client';

import type { AdminProductDetail } from '@nilzora/contracts';
import { Alert, Button, cn, Field, Input } from '@nilzora/ui';
// Type-only: erased at build time, so no server code reaches the browser.
import type { FormState } from '@nilzora/web-session';
import { useActionState, useId, type ReactNode } from 'react';
import { ConfirmForm, type ConfirmFormProps } from '@/components/admin-kit/confirm-form';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import {
  adjustStockAction,
  setProductStatusAction,
  submitForReviewAction,
  withdrawReviewAction,
} from '@/lib/catalog-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * The product forms. Each posts to a Server Action (which checks the CSRF field, the
 * Origin and, through the API, the account's permissions) and works without
 * JavaScript; with it, useActionState keeps what was typed and shows field messages
 * without a reload. Successes redirect back to the product with a notice.
 */

export const INITIAL_STATE: FormState = { status: 'idle' };

export type Action = (previous: FormState, formData: FormData) => Promise<FormState>;

export function FormError({ state }: { state: FormState }) {
  if (state.status !== 'error' || !state.message) return null;
  return (
    <Alert tone="danger">
      <AutoText value={state.message} />
    </Alert>
  );
}

/** A value to show: what was just typed (after a refusal), else the saved one. */
export function shown(state: FormState, field: string, saved: string): string {
  return state.values?.[field] ?? saved;
}

export function Checkbox({
  id,
  name,
  form,
  defaultChecked,
  label,
  hint,
}: {
  id: string;
  name: string;
  /** The form this box belongs to, when it sits outside the <form> element. */
  form?: string;
  defaultChecked: boolean;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        name={name}
        form={form}
        defaultChecked={defaultChecked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5 size-5 shrink-0 cursor-pointer accent-primary-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <div className="grid gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-foreground">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export function StockAdjustForm({
  csrf,
  productId,
  stockQuantity,
}: {
  csrf: CsrfInput;
  productId: string;
  stockQuantity: number;
}) {
  const tx = useTx();
  const [state, formAction, pending] = useActionState(adjustStockAction, INITIAL_STATE);
  const errors = state.fieldErrors ?? {};
  const direction = state.values?.direction ?? 'add';
  const legendId = useId();
  return (
    <form action={formAction} className="grid gap-4" noValidate>
      <CsrfField csrf={csrf} />
      <input type="hidden" name="productId" value={productId} />
      <FormError state={state} />
      <fieldset aria-labelledby={legendId} className="grid gap-2">
        <legend id={legendId} className="text-sm font-medium text-foreground">
          <AutoText>Change</AutoText>
        </legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['add', 'Add units'],
              ['remove', 'Remove units'],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={cn(
                'flex h-10 cursor-pointer items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface text-sm font-medium text-foreground transition-colors hover:bg-surface-muted max-sm:h-11',
                'has-checked:border-info-line has-checked:bg-info-soft has-checked:text-info-ink',
                'has-focus-visible:outline-2 has-focus-visible:outline-ring',
              )}
            >
              <input
                type="radio"
                name="direction"
                value={value}
                defaultChecked={direction === value}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        id="stock-quantity"
        label={tx('Units')}
        error={errors.quantity}
        required
        hint={`${String(stockQuantity)} in stock now. Stock never goes below zero.`}
      >
        {(control) => (
          <Input
            {...control}
            name="quantity"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            className="tabular-nums"
            defaultValue={shown(state, 'quantity', '')}
          />
        )}
      </Field>
      <Field
        id="stock-note"
        label={tx('Reason')}
        error={errors.note}
        required
        hint={tx(
          'Recorded in the stock ledger, e.g. “Received from supplier” or “Damaged in storage”.',
        )}
      >
        {(control) => (
          <Input {...control} name="note" maxLength={300} defaultValue={shown(state, 'note', '')} />
        )}
      </Field>
      <Button type="submit" variant="outline" loading={pending}>
        <AutoText>Record adjustment</AutoText>
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Review and publishing actions
// ---------------------------------------------------------------------------

/** A single-button form (for changes that are easy to undo). */
function ButtonForm({
  action,
  csrf,
  productId,
  label,
  variant = 'primary',
  size = 'md',
  compact = false,
  fields = {},
}: {
  action: Action;
  csrf: CsrfInput;
  productId: string;
  label: ReactNode;
  variant?: 'primary' | 'outline' | 'ghost';
  size?: 'sm' | 'md';
  /** A one-line refusal under the button, for table rows. */
  compact?: boolean;
  fields?: Readonly<Record<string, string>>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);
  const failed = state.status === 'error' && state.message;
  return (
    <form action={formAction} className={compact ? 'grid justify-items-end gap-1' : 'grid gap-3'}>
      <CsrfField csrf={csrf} />
      <input type="hidden" name="productId" value={productId} />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {compact ? null : <FormError state={state} />}
      <Button
        type="submit"
        variant={variant}
        size={size}
        loading={pending}
        className={compact ? undefined : 'w-full sm:w-auto'}
      >
        {label}
      </Button>
      {compact && failed ? (
        <p
          role="alert"
          className="max-w-56 text-right text-xs font-medium whitespace-normal text-danger-ink"
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

export function SubmitForReviewForm({ csrf, productId }: { csrf: CsrfInput; productId: string }) {
  const tx = useTx();
  return (
    <ButtonForm
      action={submitForReviewAction}
      csrf={csrf}
      productId={productId}
      label={tx('Submit for review')}
    />
  );
}

export function PublishForm({
  csrf,
  productId,
  /** The store owner publishing unapproved content: the click is the approval. */
  approvesContent = false,
}: {
  csrf: CsrfInput;
  productId: string;
  approvesContent?: boolean;
}) {
  const tx = useTx();
  if (approvesContent) {
    return (
      <ConfirmedAction
        action={setProductStatusAction}
        csrf={csrf}
        trigger="Publish without review"
        triggerVariant="primary"
        title={tx('Publish and approve this content yourself?')}
        description={tx(
          "You are the store owner. Publishing approves the content as it stands and puts the product on sale without a moderator's review.",
        )}
        confirmLabel={tx('Publish')}
        hiddenFields={{ productId, status: 'active' }}
      />
    );
  }
  return (
    <ButtonForm
      action={setProductStatusAction}
      csrf={csrf}
      productId={productId}
      label={tx('Publish')}
      fields={{ status: 'active' }}
    />
  );
}

export function RestoreForm({ csrf, productId }: { csrf: CsrfInput; productId: string }) {
  const tx = useTx();
  return (
    <ButtonForm
      action={setProductStatusAction}
      csrf={csrf}
      productId={productId}
      label={tx('Restore as draft')}
      variant="outline"
      fields={{ status: 'draft' }}
    />
  );
}

type ConfirmedProps = Omit<ConfirmFormProps, 'action' | 'error' | 'hiddenFields'> & {
  action: Action;
  hiddenFields: Readonly<Record<string, string>>;
};

/** ConfirmForm with the action's refusal shown inside the confirmation panel. */
export function ConfirmedAction({ action, ...props }: ConfirmedProps) {
  const [state, formAction] = useActionState(action, INITIAL_STATE);
  return (
    <ConfirmForm
      {...props}
      action={formAction}
      error={state.status === 'error' ? state.message : undefined}
    />
  );
}

export function WithdrawReviewForm({ csrf, productId }: { csrf: CsrfInput; productId: string }) {
  const tx = useTx();
  return (
    <ConfirmedAction
      action={withdrawReviewAction}
      csrf={csrf}
      align="start"
      trigger="Withdraw review"
      title={tx('Withdraw this review?')}
      description={tx(
        'The moderator will no longer see it. Edit the content, then submit it again.',
      )}
      confirmLabel={tx('Yes, withdraw it')}
      tone="primary"
      hiddenFields={{ productId }}
    />
  );
}

export function UnpublishForm({ csrf, productId }: { csrf: CsrfInput; productId: string }) {
  const tx = useTx();
  return (
    <ConfirmedAction
      action={setProductStatusAction}
      csrf={csrf}
      align="start"
      trigger="Unpublish"
      title={tx('Take this product off sale?')}
      description={tx(
        'It becomes a draft and disappears from the storefront. Its approval is kept, so it can be published again.',
      )}
      confirmLabel={tx('Unpublish')}
      hiddenFields={{ productId, status: 'draft' }}
    />
  );
}

export function ArchiveForm({ csrf, productId }: { csrf: CsrfInput; productId: string }) {
  const tx = useTx();
  return (
    <ConfirmedAction
      action={setProductStatusAction}
      csrf={csrf}
      align="start"
      trigger="Archive"
      triggerVariant="ghost"
      title={tx('Archive this product?')}
      description={tx(
        'It is hidden from the storefront and from new orders. Past orders keep their details. It can be restored as a draft later.',
      )}
      confirmLabel={tx('Archive product')}
      hiddenFields={{ productId, status: 'archived' }}
    />
  );
}

// ---------------------------------------------------------------------------
// Product list row actions
// ---------------------------------------------------------------------------

/** The name for assistive technology after a short visible label ("Publish", "Archive"). */
function Named({ label, name }: { label: string; name: string }) {
  return (
    <>
      {label}{' '}
      <span className="sr-only">
        <AutoText value={name} />
      </span>
    </>
  );
}

export interface ProductRowActionsProps {
  csrf: CsrfInput;
  product: Pick<AdminProductDetail, 'id' | 'name' | 'status' | 'moderationStatus'>;
  /** The list's own address (with its filters), to come back to after a change. */
  returnTo: string;
  /** super_admin: may publish content a review has not approved. */
  owner?: boolean;
}

/**
 * Status changes from the product list (for products.publish holders; the page decides
 * whether to render them). Publishing needs approved content; unpublishing and
 * archiving ask for confirmation. The Server Action checks everything again.
 */
export function ProductRowActions({
  csrf,
  product,
  returnTo,
  owner = false,
}: ProductRowActionsProps) {
  const tx = useTx();
  const { id, name, status, moderationStatus } = product;
  const fields = (next: string) => ({ productId: id, status: next, returnTo });
  /** The store owner publishing unapproved content approves it as it stands. */
  const ownerPublish = owner && moderationStatus !== 'approved';
  return (
    <>
      {status !== 'active' && moderationStatus === 'approved' ? (
        <ButtonForm
          action={setProductStatusAction}
          csrf={csrf}
          productId={id}
          label={<Named label={tx('Publish')} name={name} />}
          variant="outline"
          size="sm"
          compact
          fields={{ status: 'active', returnTo }}
        />
      ) : null}
      {status !== 'active' && ownerPublish ? (
        <ConfirmedAction
          action={setProductStatusAction}
          csrf={csrf}
          trigger={<Named label={tx('Publish')} name={name} />}
          triggerVariant="outline"
          title={`Publish “${name}” without a review?`}
          description={tx(
            "You are the store owner. Publishing approves the content as it stands and puts the product on sale without a moderator's review.",
          )}
          confirmLabel={tx('Publish')}
          hiddenFields={fields('active')}
        />
      ) : null}
      {status === 'active' ? (
        <ConfirmedAction
          action={setProductStatusAction}
          csrf={csrf}
          trigger={<Named label={tx('Unpublish')} name={name} />}
          triggerVariant="ghost"
          title={`Take “${name}” off sale?`}
          description={tx(
            'It becomes a draft and disappears from the storefront. Its approval is kept.',
          )}
          confirmLabel={tx('Unpublish')}
          hiddenFields={fields('draft')}
        />
      ) : null}
      {status === 'archived' ? (
        <ButtonForm
          action={setProductStatusAction}
          csrf={csrf}
          productId={id}
          label={<Named label={tx('Restore')} name={name} />}
          variant="ghost"
          size="sm"
          compact
          fields={{ status: 'draft', returnTo }}
        />
      ) : (
        <ConfirmedAction
          action={setProductStatusAction}
          csrf={csrf}
          trigger={<Named label={tx('Archive')} name={name} />}
          triggerVariant="ghost"
          title={`Archive “${name}”?`}
          description={tx(
            'It is hidden from the storefront and from new orders. It can be restored as a draft later.',
          )}
          confirmLabel={tx('Archive product')}
          hiddenFields={fields('archived')}
        />
      )}
    </>
  );
}
