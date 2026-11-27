'use client';

import type { AdminCategory } from '@nilzora/contracts';
import { Button, cn, Field, Input, Textarea } from '@nilzora/ui';
// Type-only: erased at build time, so no server code reaches the browser.
import type { FormState } from '@nilzora/web-session';
import { CircleAlert, Save, Undo2 } from 'lucide-react';
import {
  createContext,
  Fragment,
  useActionState,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useInteractive } from '@/components/admin-kit/use-interactive';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { createProductAction, updateProductAction } from '@/lib/catalog-actions';
import { CategoryPicker } from './category-picker';
import type { FieldErrors, FormValues } from './form-values';
import {
  checkCreateFields,
  checkEditFields,
  CREATE_FIELDS,
  discountPercent,
  OPTIONAL_SECTION_FIELDS,
  SECTION_FIELDS,
  type ProductSection,
} from './product-validation';
import { SizeChartEditor } from './size-chart-editor';
import { SlugField } from './slug-field';
import { TagInput } from './tag-input';
import { useUnsavedChanges } from './use-unsaved-changes';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * The product form. One form covers every section the account may change now, whether
 * the page lays them out together or apart: the fields join the form through the HTML
 * `form` attribute, so sections with forms of their own (images, stock) sit between them
 * without nesting forms. It works without JavaScript (one Save posts everything); with it:
 *
 * - a sticky save bar appears once something differs from the saved product, with Save
 *   and Discard, and the page warns before unsaved changes are lost;
 * - every field is checked as staff type, with the same contract rules the Server Action
 *   applies again (and the API after it); a form with mistakes is not sent;
 * - the address is made from the name until it is typed by hand, and checked for clashes.
 */

const INITIAL: FormState = { status: 'idle' };

/** The create form has no sections: one constant, so its fields are stable between renders. */
const NO_SECTIONS: readonly ProductSection[] = [];

function sameErrors(a: FieldErrors, b: FieldErrors): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** How the save bar names a field that needs attention. */
export const FIELD_LABELS: Partial<Record<string, string>> = {
  name: 'Name',
  categoryId: 'Category',
  slug: 'Storefront address',
  summary: 'Summary',
  description: 'Description',
  price: 'Price',
  compareAtPrice: 'Former price',
  maxOrderQuantity: 'Most units per order',
  isFeatured: 'Featuring',
  sku: 'SKU',
  initialStock: 'Opening stock',
  tags: 'Tags',
  sizeChart: 'Size chart',
};

/**
 * Moves focus to a field of the product form and brings it into view. Visible inputs carry
 * the form's id and the field's name; the chart and tag editors post through a hidden input,
 * so their own control (id ending in "-<field>") is focused instead.
 */
function focusField(formId: string, field: string) {
  const named = Array.from(
    document.querySelectorAll<HTMLElement>(`[form="${formId}"][name="${field}"]`),
  ).find((element) => (element as HTMLInputElement).type !== 'hidden');
  const target = named ?? document.querySelector<HTMLElement>(`[id$="-${field}"]`);
  if (!target) return;
  // Not every environment implements it (jsdom does not).
  (target as Partial<Pick<HTMLElement, 'scrollIntoView'>>).scrollIntoView?.({ block: 'center' });
  target.focus({ preventScroll: true });
}

interface ProductFormContextValue {
  formId: string;
  creating: boolean;
  csrf: CsrfInput;
  /** A field's message: the server's, or this form's own once the field was visited. */
  error: (field: string) => string | undefined;
  /** What a field starts with: what was just typed (after a refusal), else the saved value. */
  initial: (field: string) => string;
  /** Tells the form a field changed without an input event (chips, the chart, suggestions). */
  changed: (field: string) => void;
  /** Changes on Discard: field groups remount from `initial` with it. */
  resetKey: number;
}

const ProductFormContext = createContext<ProductFormContextValue | null>(null);

export function useProductForm(): ProductFormContextValue {
  const value = useContext(ProductFormContext);
  if (!value) throw new Error('Product fields must be placed inside a ProductForm.');
  return value;
}

/** The fields a form with these sections sends (optional ones only when shown). */
function fieldsOf(creating: boolean, sections: readonly ProductSection[]): string[] {
  if (creating) {
    return [
      ...CREATE_FIELDS,
      ...OPTIONAL_SECTION_FIELDS.content,
      ...OPTIONAL_SECTION_FIELDS.ordering,
    ];
  }
  return sections.flatMap((section) => [
    ...SECTION_FIELDS[section],
    ...OPTIONAL_SECTION_FIELDS[section],
  ]);
}

/** The form's current values, as the Server Action will read them. */
function readValues(form: HTMLFormElement, fields: readonly string[]): FormValues {
  const data = new FormData(form);
  const values: FormValues = {};
  for (const field of fields) {
    if (field === 'isFeatured') {
      values[field] = data.has(field) ? 'on' : '';
      continue;
    }
    const value = data.get(field);
    if (typeof value === 'string') values[field] = value.trim();
  }
  return values;
}

export interface ProductFormProps {
  mode: 'create' | 'edit';
  productId?: string;
  /** Edit: the sections this account may change right now (only these are sent). */
  sections?: readonly ProductSection[];
  /** The saved value of every field the form may show, to tell changes apart. */
  saved: FormValues;
  csrf: CsrfInput;
  /** Shown in the save bar when nothing has changed yet, e.g. what saving does. */
  note?: ReactNode;
  children: ReactNode;
}

export function ProductForm({
  mode,
  productId,
  sections = NO_SECTIONS,
  saved,
  csrf,
  note,
  children,
}: ProductFormProps) {
  const tx = useTx();
  const creating = mode === 'create';
  const [received, formAction, pending] = useActionState(
    creating ? createProductAction : updateProductAction,
    INITIAL,
  );
  const formId = `product-form-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const formRef = useRef<HTMLFormElement>(null);
  const interactive = useInteractive();
  const fields = useMemo(() => fieldsOf(creating, sections), [creating, sections]);

  // A save that worked comes back with new saved values: the last answer no longer applies.
  const savedKey = JSON.stringify(saved);
  const [seenSaved, setSeenSaved] = useState(savedKey);
  const [dismissed, setDismissed] = useState<FormState | null>(null);
  if (seenSaved !== savedKey) {
    setSeenSaved(savedKey);
    setDismissed(received);
  }
  const state = dismissed === received ? INITIAL : received;

  // A new answer: fields edited before it are judged by it again.
  const [seenAnswer, setSeenAnswer] = useState(received);
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set());
  if (seenAnswer !== received) {
    setSeenAnswer(received);
    setEdited(new Set());
  }

  const [dirty, setDirty] = useState(false);
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const validate = useCallback(
    (values: FormValues) =>
      creating ? checkCreateFields(values) : checkEditFields(sections, values),
    [creating, sections],
  );

  const recheck = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const values = readValues(form, fields);
    // The form's values are trimmed, so the saved ones are too: a size chart whose last cell
    // is empty ("XL | 108 | ") would otherwise differ from itself for ever.
    setDirty(
      fields.some(
        (field) => values[field] !== undefined && values[field] !== (saved[field] ?? '').trim(),
      ),
    );
    const found = validate(values);
    // The same messages are the same state: a fresh object each time would render again,
    // which checks again, for ever.
    setClientErrors((previous) => (sameErrors(previous, found) ? previous : found));
  }, [fields, saved, validate]);

  const timer = useRef<number | undefined>(undefined);
  /** Rechecks once React has applied the change that triggered it. */
  const schedule = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(recheck, 0);
  }, [recheck]);

  const mark = useCallback((field: string, set: 'edited' | 'touched') => {
    const update = (previous: ReadonlySet<string>) =>
      previous.has(field) ? previous : new Set([...previous, field]);
    if (set === 'edited') setEdited(update);
    else setTouched(update);
  }, []);

  const changed = useCallback(
    (field: string) => {
      mark(field, 'edited');
      mark(field, 'touched');
      schedule();
    },
    [mark, schedule],
  );

  useEffect(() => {
    const owns = (target: EventTarget | null): target is HTMLInputElement =>
      target instanceof Element &&
      'form' in target &&
      (target as HTMLInputElement).form === formRef.current &&
      formRef.current !== null;
    const onInput = (event: Event) => {
      if (!owns(event.target)) return;
      if (event.target.name) mark(event.target.name, 'edited');
      schedule();
    };
    const onLeave = (event: FocusEvent) => {
      if (!owns(event.target)) return;
      if (event.target.name) mark(event.target.name, 'touched');
      schedule();
    };
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onInput, true);
    document.addEventListener('focusout', onLeave, true);
    return () => {
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('change', onInput, true);
      document.removeEventListener('focusout', onLeave, true);
      window.clearTimeout(timer.current);
    };
  }, [mark, schedule]);

  // Saved values, an answer or a discard change what the fields show: look again.
  useEffect(() => {
    schedule();
  }, [schedule, savedKey, received, resetKey]);

  useUnsavedChanges(interactive && dirty && !pending);

  const error = useCallback(
    (field: string) => {
      const server = state.status === 'error' ? state.fieldErrors?.[field] : undefined;
      const own = touched.has(field) || attempted ? clientErrors[field] : undefined;
      // This form's own check first; the server's message until the field is changed.
      if (own) return own;
      return edited.has(field) ? undefined : server;
    },
    [state, touched, attempted, clientErrors, edited],
  );

  const initial = useCallback(
    (field: string) => state.values?.[field] ?? saved[field] ?? '',
    [state, saved],
  );

  const discard = () => {
    setDismissed(received);
    setAttempted(false);
    setTouched(new Set());
    setEdited(new Set());
    setResetKey((key) => key + 1);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    const errors = validate(readValues(event.currentTarget, fields));
    setClientErrors(errors);
    setAttempted(true);
    const invalid = Object.keys(errors);
    if (invalid.length === 0) return;
    // Nothing is sent while a field is known to be wrong; the first one gets focus.
    event.preventDefault();
    const first = Array.from(event.currentTarget.elements).find(
      (element): element is HTMLInputElement =>
        element instanceof HTMLElement &&
        'name' in element &&
        invalid.includes((element as HTMLInputElement).name) &&
        (element as HTMLInputElement).type !== 'hidden',
    );
    first?.focus();
  };

  const context = useMemo<ProductFormContextValue>(
    () => ({ formId, creating, csrf, error, initial, changed, resetKey }),
    [formId, creating, csrf, error, initial, changed, resetKey],
  );

  // Nothing the account may change: the page shows the product read-only.
  const editable = creating || sections.length > 0;
  if (!editable)
    return (
      <ProductFormContext value={context}>
        <AutoText value={children} />
      </ProductFormContext>
    );

  const failed = state.status === 'error' && state.message ? state.message : null;
  // Every field with a message right now: this form's own checks, then the server's.
  const serverFields = state.status === 'error' ? Object.keys(state.fieldErrors ?? {}) : [];
  const problemFields = [
    ...new Set([
      ...(attempted ? Object.keys(clientErrors) : []),
      ...serverFields.filter((field) => !edited.has(field)),
    ]),
  ].filter((field) => error(field) !== undefined);
  const problems = problemFields.length;
  const showBar = creating || !interactive || dirty || pending || failed !== null;

  return (
    <ProductFormContext value={context}>
      {children}
      <form
        ref={formRef}
        id={formId}
        action={formAction}
        onSubmit={onSubmit}
        noValidate
        className="hidden"
      >
        <CsrfField csrf={csrf} />
        {productId ? <input type="hidden" name="productId" value={productId} /> : null}
        {creating
          ? null
          : sections.map((section) => (
              <input key={section} type="hidden" name="section" value={section} />
            ))}
      </form>
      {showBar ? (
        <div
          className={cn('z-30', interactive && 'nz-fade-in sticky bottom-3 sm:bottom-4')}
          role="region"
          aria-label={tx('Save changes')}
        >
          <div className="nz-glass grid gap-3 rounded-2xl border px-4 py-3 shadow-glass-lg sm:px-5">
            {failed ? (
              <p
                role="alert"
                className="flex items-start gap-2 text-sm font-medium text-danger-ink"
              >
                <CircleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0"
                  strokeWidth={1.75}
                />
                {failed}
              </p>
            ) : null}
            {problems > 0 ? (
              <div className="grid gap-1.5">
                <p id={`${formId}-problems`} className="text-xs font-medium text-danger-ink">
                  {problems === 1 ? 'Check this field:' : 'Check these fields:'}
                </p>
                <ul aria-labelledby={`${formId}-problems`} className="flex flex-wrap gap-1.5">
                  {problemFields.map((field) => (
                    <li key={field}>
                      <button
                        type="button"
                        onClick={() => focusField(formId, field)}
                        className="inline-flex min-h-8 items-center rounded-full bg-danger-soft px-3 text-xs font-medium text-danger-ink ring-1 ring-danger-line ring-inset hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-sm:min-h-10"
                      >
                        {FIELD_LABELS[field] ?? field}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                {dirty ? (
                  <>
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-warning" />
                    <span className="font-medium text-foreground">
                      <AutoText>Unsaved changes</AutoText>
                    </span>
                    {problems > 0 ? (
                      <span className="text-danger-ink">
                        ·{' '}
                        {problems === 1
                          ? '1 field needs attention'
                          : `${String(problems)} fields need attention`}
                      </span>
                    ) : null}
                  </>
                ) : (
                  note
                )}
              </p>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {interactive && dirty ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={discard}
                    disabled={pending}
                    className="max-sm:min-h-11 max-sm:flex-1"
                  >
                    <Undo2 aria-hidden="true" strokeWidth={1.75} />
                    <AutoText>Discard</AutoText>
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  form={formId}
                  loading={pending}
                  className="max-sm:min-h-11 max-sm:flex-1"
                >
                  {pending ? null : <Save aria-hidden="true" strokeWidth={1.75} />}
                  {creating
                    ? pending
                      ? 'Creating…'
                      : 'Create draft'
                    : pending
                      ? 'Saving…'
                      : 'Save changes'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </ProductFormContext>
  );
}

// ---------------------------------------------------------------------------
// Field groups (each remounts on Discard, so it shows the saved values again)
// ---------------------------------------------------------------------------

function MoneyInput(props: ComponentProps<'input'>) {
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground"
      >
        ৳
      </span>
      <Input
        {...props}
        inputMode="decimal"
        autoComplete="off"
        className="pl-7 tabular-nums max-sm:h-11"
      />
    </div>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  return (
    <span
      className={cn(
        'text-xs tabular-nums',
        value.length > max ? 'font-medium text-danger-ink' : 'text-muted-foreground',
      )}
    >
      {value.length.toLocaleString('en-US')}/{max.toLocaleString('en-US')}
    </span>
  );
}

/** Name, category, address, summary and description (content: reviewed). */
export function BasicInfoFields({
  categories,
  productId,
  savedSlug,
}: {
  categories: readonly AdminCategory[];
  productId?: string;
  savedSlug?: string;
}) {
  const { resetKey } = useProductForm();
  return (
    <BasicInfoInputs
      key={resetKey}
      categories={categories}
      productId={productId}
      savedSlug={savedSlug}
    />
  );
}

function BasicInfoInputs({
  categories,
  productId,
  savedSlug,
}: {
  categories: readonly AdminCategory[];
  productId?: string;
  savedSlug?: string;
}) {
  const tx = useTx();
  const { formId, creating, csrf, error, initial, changed } = useProductForm();
  const [name, setName] = useState(initial('name'));
  const [summary, setSummary] = useState(initial('summary'));
  const [description, setDescription] = useState(initial('description'));
  const onSlug = useCallback(() => changed('slug'), [changed]);
  const prefix = creating ? 'create' : 'content';
  return (
    <div className="grid gap-5">
      <Field id={`${prefix}-name`} label={tx('Name')} error={error('name')} required>
        {(control) => (
          <Input
            {...control}
            form={formId}
            name="name"
            maxLength={160}
            defaultValue={initial('name')}
            onChange={(event) => setName(event.currentTarget.value)}
            className="max-sm:h-11"
          />
        )}
      </Field>
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <CategoryPicker
          categories={categories}
          initialId={initial('categoryId')}
          formId={formId}
          idPrefix={prefix}
          error={error('categoryId')}
        />
        <SlugField
          id={`${prefix}-slug`}
          form={formId}
          label={tx('Storefront address')}
          kind="product"
          initial={initial('slug')}
          source={name}
          auto={creating}
          savedSlug={savedSlug}
          excludeId={productId}
          csrf={csrf}
          error={error('slug')}
          required={!creating}
          onChange={onSlug}
          hint={
            creating
              ? 'Shown as /products/<address>. Made from the name until you type one.'
              : 'Shown as /products/<address>. Changing it breaks links shared before.'
          }
        />
      </div>
      <Field
        id={`${prefix}-summary`}
        label={tx('Summary')}
        error={error('summary')}
        hint={
          <>
            One or two sentences for product cards. <Counter value={summary} max={300} />
          </>
        }
      >
        {(control) => (
          <Textarea
            {...control}
            form={formId}
            name="summary"
            rows={2}
            defaultValue={initial('summary')}
            onChange={(event) => setSummary(event.currentTarget.value)}
          />
        )}
      </Field>
      <Field
        id={`${prefix}-description`}
        label={tx('Description')}
        error={error('description')}
        hint={
          <>
            Materials, sizes, care and what is in the box.{' '}
            <Counter value={description} max={5000} />
          </>
        }
      >
        {(control) => (
          <Textarea
            {...control}
            form={formId}
            name="description"
            rows={8}
            defaultValue={initial('description')}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
        )}
      </Field>
    </div>
  );
}

/** Price and former price in taka, with the discount they make. */
export function PricingFields() {
  const { resetKey } = useProductForm();
  return <PricingInputs key={resetKey} />;
}

function PricingInputs() {
  const tx = useTx();
  const { formId, creating, error, initial } = useProductForm();
  const [price, setPrice] = useState(initial('price'));
  const [compare, setCompare] = useState(initial('compareAtPrice'));
  const discount = discountPercent(price, compare);
  const prefix = creating ? 'create' : 'pricing';
  return (
    <div className="grid gap-4">
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field
          id={`${prefix}-price`}
          label={tx('Price (BDT)')}
          error={error('price')}
          required
          hint={tx('In taka, e.g. 1250 or 1250.50.')}
        >
          {(control) => (
            <MoneyInput
              {...control}
              form={formId}
              name="price"
              defaultValue={initial('price')}
              onChange={(event) => setPrice(event.currentTarget.value)}
            />
          )}
        </Field>
        <Field
          id={`${prefix}-compareAtPrice`}
          label={tx('Former price (BDT)')}
          error={error('compareAtPrice')}
          hint={tx('Optional. Shown struck through; must be higher than the price.')}
        >
          {(control) => (
            <MoneyInput
              {...control}
              form={formId}
              name="compareAtPrice"
              defaultValue={initial('compareAtPrice')}
              onChange={(event) => setCompare(event.currentTarget.value)}
            />
          )}
        </Field>
      </div>
      {discount !== null ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-flex h-6 items-center rounded-full bg-offer-soft px-2.5 text-xs font-semibold text-offer-ink ring-1 ring-offer-line ring-inset">
            {discount}% off
          </span>
          <AutoText>Shoppers see the former price struck through beside the price.</AutoText>
        </p>
      ) : null}
    </div>
  );
}

/** The per-order limit (operations: changed like the price). */
export function OrderLimitField() {
  const tx = useTx();
  const { resetKey, formId, creating, error, initial } = useProductForm();
  const prefix = creating ? 'create' : 'ordering';
  return (
    <Fragment key={resetKey}>
      <Field
        id={`${prefix}-maxOrderQuantity`}
        label={tx('Most units per order')}
        error={error('maxOrderQuantity')}
        required
        hint={tx('1 to 100. Orders are also capped by the stock available.')}
      >
        {(control) => (
          <Input
            {...control}
            form={formId}
            name="maxOrderQuantity"
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            step={1}
            className="tabular-nums max-sm:h-11"
            defaultValue={initial('maxOrderQuantity')}
          />
        )}
      </Field>
    </Fragment>
  );
}

/** SKU and opening stock, set once when the product is created. */
export function StockKeepingFields() {
  const tx = useTx();
  const { formId, error, initial } = useProductForm();
  return (
    <div className="grid items-start gap-5 sm:grid-cols-2">
      <Field
        id="create-sku"
        label={tx('SKU')}
        error={error('sku')}
        required
        hint={tx('2 to 40 letters, digits or hyphens, e.g. NZ-PANJABI-M. It cannot change later.')}
      >
        {(control) => (
          <Input
            {...control}
            form={formId}
            name="sku"
            maxLength={40}
            autoCapitalize="characters"
            spellCheck={false}
            className="font-mono uppercase max-sm:h-11"
            defaultValue={initial('sku')}
          />
        )}
      </Field>
      <Field
        id="create-initialStock"
        label={tx('Opening stock')}
        error={error('initialStock')}
        hint={tx('Units on hand now, recorded in the stock ledger. Later changes need a reason.')}
      >
        {(control) => (
          <Input
            {...control}
            form={formId}
            name="initialStock"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            className="tabular-nums max-sm:h-11"
            defaultValue={initial('initialStock')}
          />
        )}
      </Field>
    </div>
  );
}

/** Featuring and tags (merchandising: changed like the price). */
export function MerchandisingFields({ showTags }: { showTags: boolean }) {
  const { resetKey } = useProductForm();
  return <MerchandisingInputs key={resetKey} showTags={showTags} />;
}

function MerchandisingInputs({ showTags }: { showTags: boolean }) {
  const tx = useTx();
  const { formId, creating, error, initial, changed } = useProductForm();
  const prefix = creating ? 'create' : 'ordering';
  const onTags = useCallback(() => changed('tags'), [changed]);
  return (
    <div className="grid gap-5">
      <FeatureToggle
        id={`${prefix}-isFeatured`}
        form={formId}
        defaultChecked={initial('isFeatured') === 'on'}
      />
      {showTags ? (
        <Field
          id={`${prefix}-tags`}
          label={tx('Tags')}
          error={error('tags')}
          hint={tx(
            'For staff only: group products for campaigns and searches. Press Enter or type a comma after each tag.',
          )}
        >
          {(control) => (
            <TagInput
              id={control.id}
              form={formId}
              initial={initial('tags')}
              aria-describedby={control['aria-describedby']}
              aria-invalid={control['aria-invalid']}
              onChange={onTags}
            />
          )}
        </Field>
      ) : null}
    </div>
  );
}

function FeatureToggle({
  id,
  form,
  defaultChecked,
}: {
  id: string;
  form: string;
  defaultChecked: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-hairline bg-neutral-soft/50 p-3">
      <input
        id={id}
        type="checkbox"
        name="isFeatured"
        form={form}
        defaultChecked={defaultChecked}
        aria-describedby={`${id}-hint`}
        className="mt-0.5 size-5 shrink-0 cursor-pointer accent-primary-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <div className="grid gap-0.5">
        <label htmlFor={id} className="cursor-pointer text-sm font-medium text-foreground">
          <AutoText>Feature in the storefront</AutoText>
        </label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          <AutoText>Featured products on sale are highlighted on the home page.</AutoText>
        </p>
      </div>
    </div>
  );
}

/** The size chart shoppers see (content: reviewed, locked while on sale). */
export function SizeChartField() {
  const tx = useTx();
  const { resetKey, formId, creating, csrf, error, initial, changed } = useProductForm();
  const onChart = useCallback(() => changed('sizeChart'), [changed]);
  const id = `${creating ? 'create' : 'content'}-sizeChart`;
  return (
    <Field
      id={id}
      label={tx('Size chart')}
      error={error('sizeChart')}
      hint={tx(
        'Optional. Without JavaScript: one row per line, entries separated by |, the first line naming the columns.',
      )}
    >
      {(control) => (
        <SizeChartEditor
          key={resetKey}
          id={control.id}
          form={formId}
          initial={initial('sizeChart')}
          csrf={csrf}
          aria-describedby={control['aria-describedby']}
          aria-invalid={control['aria-invalid']}
          onChange={onChart}
        />
      )}
    </Field>
  );
}
