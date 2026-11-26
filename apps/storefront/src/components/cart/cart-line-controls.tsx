'use client';

import { Button, NativeSelect } from '@nilzora/ui';
// Type-only: the session package is server-only.
import type { FormState } from '@nilzora/web-session';
import { Trash2 } from 'lucide-react';
import { createContext, use, useActionState, useEffect, useRef, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { announceCartChange } from '@/lib/cart-events';
import { FormMessage, IDLE_STATE, type FormAction } from '../auth/form-kit';
import { clearCartRemovalNote, noteCartRemoval } from './cart-emptied-signal';

/*
 * The cart page's line forms. Each is a plain form posting productId (and quantity)
 * to the cart actions, so it also works without JavaScript; the actions rewrite the
 * cart cookie and the page is rendered again with fresh prices. Removing a line
 * unmounts its form, so removals report in one message area above the list.
 */

interface CartForms {
  update: FormAction;
  remove: (formData: FormData) => void;
}

const CartFormsContext = createContext<CartForms | null>(null);

function useCartForms(): CartForms {
  const forms = use(CartFormsContext);
  if (!forms) throw new Error('Cart line forms must be rendered inside CartFormsProvider.');
  return forms;
}

/** Tells the header badge the new unit count after a successful cart change. */
function useAnnounceCartChange(state: FormState): void {
  useEffect(() => {
    const count = Number(state.values?.count);
    if (state.status === 'success' && Number.isSafeInteger(count)) announceCartChange(count);
  }, [state]);
}

export function CartFormsProvider({
  updateAction,
  removeAction,
  children,
}: {
  updateAction: FormAction;
  removeAction: FormAction;
  children: ReactNode;
}) {
  const [removeState, remove] = useActionState(removeAction, IDLE_STATE);
  const messageRef = useRef<HTMLDivElement>(null);
  useAnnounceCartChange(removeState);

  // The removed line's button is gone: keep keyboard focus on the page, at the message.
  useEffect(() => {
    if (removeState.status !== 'success') return;
    clearCartRemovalNote();
    messageRef.current?.focus();
  }, [removeState]);

  return (
    <CartFormsContext value={{ update: updateAction, remove }}>
      <div ref={messageRef} tabIndex={-1} className="pt-5 outline-none empty:hidden">
        <FormMessage state={removeState} />
      </div>
      {children}
    </CartFormsContext>
  );
}

/** Uses its own form's pending state, so only the button that was pressed shows progress. */
function SubmitButton({
  variant,
  icon,
  children,
}: {
  variant: 'outline' | 'ghost';
  icon?: ReactNode;
  children: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size="sm"
      loading={pending}
      // 44px on a phone or any touch screen; the compact 32px stays for a mouse at `sm`+.
      className="max-sm:h-11 max-sm:min-w-11 pointer-coarse:h-11 pointer-coarse:min-w-11"
    >
      {pending ? null : icon}
      {children}
    </Button>
  );
}

export interface CartQuantityFormProps {
  productId: string;
  /** The line's variant; absent for a simple product. */
  variantId?: string | undefined;
  productName: string;
  quantity: number;
  /** Options run from 1 to this; never below the current quantity. */
  maxQuantity: number;
}

export function CartQuantityForm({
  productId,
  variantId,
  productName,
  quantity,
  maxQuantity,
}: CartQuantityFormProps) {
  const { update } = useCartForms();
  const [state, formAction] = useActionState(update, IDLE_STATE);
  useAnnounceCartChange(state);
  // Two lines of the same product (different variants) need different control ids.
  const id = `cart-quantity-${productId}${variantId === undefined ? '' : `-${variantId}`}`;
  const options = Array.from({ length: Math.max(maxQuantity, quantity, 1) }, (_, i) => i + 1);
  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="productId" value={productId} />
      {variantId === undefined ? null : <input type="hidden" name="variantId" value={variantId} />}
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
            Quantity <span className="sr-only">for {productName}</span>
          </label>
          {/* Keyed by quantity, so a fresh render shows the saved value. */}
          <NativeSelect
            key={quantity}
            id={id}
            name="quantity"
            defaultValue={String(quantity)}
            className="h-8 w-20 py-0 max-sm:h-11 pointer-coarse:h-11"
          >
            {options.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </NativeSelect>
        </div>
        <SubmitButton variant="outline">
          Update <span className="sr-only">quantity for {productName}</span>
        </SubmitButton>
        <p aria-live="polite" className="self-center text-xs text-muted-foreground">
          {state.status === 'success' ? state.message : null}
        </p>
      </div>
      {state.status === 'error' ? <FormMessage state={state} /> : null}
    </form>
  );
}

export function CartRemoveForm({
  productId,
  variantId,
  productName,
}: {
  productId: string;
  variantId?: string | undefined;
  productName: string;
}) {
  const { remove } = useCartForms();
  return (
    // onSubmit only notes the removal; the form still posts without JavaScript.
    <form action={remove} onSubmit={noteCartRemoval}>
      <input type="hidden" name="productId" value={productId} />
      {variantId === undefined ? null : <input type="hidden" name="variantId" value={variantId} />}
      <SubmitButton variant="ghost" icon={<Trash2 aria-hidden="true" />}>
        Remove <span className="sr-only">{productName} from your cart</span>
      </SubmitButton>
    </form>
  );
}
