'use client';

import type { AdminCategory } from '@nilzora/contracts';
import {
  Button,
  Field,
  Input,
  NativeSelect,
  SelectedImagePreview,
  Textarea,
  UploadProgress,
  useProgressUpload,
} from '@nilzora/ui';
import { useRouter } from 'next/navigation';
import { useActionState, useRef, useState } from 'react';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  moveCategoryAction,
  saveCategoryAction,
  setCategoryActiveAction,
} from '@/lib/catalog-actions';
import { uploadEndpoint } from '@/lib/upload-routes';
import { checkReportedFile } from './image-upload';
import { SlugField } from './slug-field';
import { Checkbox, ConfirmedAction, FormError, INITIAL_STATE, shown } from './product-forms';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/** Creates a category, or edits one (its visibility changes only with confirmation). */
export function CategoryForm({
  csrf,
  category,
  parents = [],
  defaultParentId,
  defaultSortOrder,
}: {
  csrf: CsrfInput;
  category?: AdminCategory;
  /** Creating a subcategory from a category's row: that category is preselected. */
  defaultParentId?: string | undefined;
  /** The order a new category starts with (last in its group); the admin can change it. */
  defaultSortOrder?: number | undefined;
  /** Every category, so the parent selector can offer the real tree. */
  parents?: readonly AdminCategory[];
}) {
  const tx = useTx();
  const [state, formAction, pending] = useActionState(saveCategoryAction, INITIAL_STATE);
  const creating = category === undefined;
  const [name, setName] = useState(shown(state, 'name', category?.name ?? ''));

  // Creating with a picture goes through the upload route, so the picture's transfer shows real
  // progress; without a picture, or without JavaScript, the Server Action creates the category.
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [picture, setPicture] = useState<File | null>(null);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const upload = useProgressUpload({
    endpoint: uploadEndpoint('category-create'),
    onSuccess: () => {
      router.push('/admin/categories?notice=category-created');
    },
  });
  const busy = pending || upload.busy;
  const failure = upload.state.phase === 'error' ? upload.state : null;
  const createdId = failure?.values?.categoryId;
  const errors = { ...state.fieldErrors, ...failure?.fieldErrors };

  // A category may never be its own parent or sit under one of its own descendants.
  const blocked = new Set<string>();
  if (category) {
    blocked.add(category.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const candidate of parents) {
        if (candidate.parentId && blocked.has(candidate.parentId) && !blocked.has(candidate.id)) {
          blocked.add(candidate.id);
          grew = true;
        }
      }
    }
  }
  const options = parents.filter((candidate) => !blocked.has(candidate.id));
  const selectedParent = state.values?.parentId ?? category?.parentId ?? defaultParentId ?? '';

  return (
    <form
      ref={formRef}
      action={formAction}
      onSubmit={(event) => {
        if (!creating || !picture || pictureError !== null) return;
        event.preventDefault();
        upload.send(event.currentTarget, picture);
      }}
      className="grid gap-5"
      noValidate
    >
      <CsrfField csrf={csrf} />
      {category ? <input type="hidden" name="categoryId" value={category.id} /> : null}
      <FormError state={state} />

      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field
          id="category-parentId"
          label={tx('Parent category')}
          error={errors.parentId}
          hint={tx(
            'Leave as a top-level department, or choose the category this one belongs under.',
          )}
        >
          {(control) => (
            <NativeSelect {...control} name="parentId" defaultValue={selectedParent}>
              <option value="">
                <AutoText>Top level (no parent)</AutoText>
              </option>
              {options.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.parentId ? `— ${candidate.name}` : candidate.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <div className="sm:pt-7">
          <Checkbox
            id="category-isFeatured"
            name="isFeatured"
            defaultChecked={
              state.values === undefined
                ? (category?.isFeatured ?? false)
                : state.values.isFeatured === 'on'
            }
            label={tx('Feature this category')}
            hint={tx('Featured categories can be highlighted on the storefront home page.')}
          />
        </div>
      </div>
      <div className="grid items-start gap-5 sm:grid-cols-2">
        <Field id="category-name" label={tx('Name')} error={errors.name} required>
          {(control) => (
            <Input
              {...control}
              name="name"
              maxLength={80}
              defaultValue={shown(state, 'name', category?.name ?? '')}
              onChange={(event) => setName(event.currentTarget.value)}
              className="max-sm:h-11"
            />
          )}
        </Field>
        <SlugField
          id="category-slug"
          label={tx('Storefront address')}
          kind="category"
          initial={shown(state, 'slug', category?.slug ?? '')}
          source={name}
          auto={creating}
          savedSlug={category?.slug}
          excludeId={category?.id}
          csrf={csrf}
          error={errors.slug}
          required={!creating}
          maxLength={80}
          hint={
            creating
              ? 'Shown as /categories/<address>. Made from the name until you type one.'
              : 'Shown as /categories/<address>. Changing it breaks old links.'
          }
        />
      </div>
      <Field
        id="category-description"
        label={tx('Description')}
        error={errors.description}
        hint={tx('Optional. Shown on the category page. Up to 500 characters.')}
      >
        {(control) => (
          <Textarea
            {...control}
            name="description"
            rows={3}
            maxLength={500}
            defaultValue={shown(state, 'description', category?.description ?? '')}
          />
        )}
      </Field>
      <Field
        id="category-sortOrder"
        label={tx('Sort order')}
        error={errors.sortOrder}
        hint={tx('Lower numbers are listed first in the storefront.')}
        className="sm:max-w-48"
      >
        {(control) => (
          <Input
            {...control}
            name="sortOrder"
            type="number"
            inputMode="numeric"
            step={1}
            className="tabular-nums"
            defaultValue={shown(
              state,
              'sortOrder',
              String(category?.sortOrder ?? defaultSortOrder ?? 0),
            )}
          />
        )}
      </Field>
      {creating ? (
        <div className="grid gap-3">
          <Field
            id="category-image"
            label={tx('Cover picture')}
            error={pictureError ?? undefined}
            hint={tx(
              "Optional. JPEG, PNG or WebP, up to 5 MB and at least 400 pixels on the shorter side. You can add or change it later. A wide page banner can be added from the category's page once it exists.",
            )}
          >
            {(control) => (
              <Input
                {...control}
                type="file"
                name="image"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(event) => {
                  const picked = event.currentTarget.files?.[0] ?? null;
                  setPicture(picked);
                  setPictureError(picked ? checkReportedFile(picked) : null);
                  upload.reset();
                }}
              />
            )}
          </Field>
          {picture && pictureError === null && upload.state.phase === 'idle' ? (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <SelectedImagePreview file={picture} />
              <span className="min-w-0 truncate">
                <AutoText value={picture.name} />
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPicture(null);
                  setPictureError(null);
                  const input = formRef.current?.elements.namedItem('image');
                  if (input instanceof HTMLInputElement) input.value = '';
                }}
              >
                <AutoText>Remove</AutoText>
              </Button>
            </div>
          ) : null}
          {/* No retry button: sending again would create the category a second time. */}
          <UploadProgress state={upload.state} />
          {createdId ? (
            <a
              href={`/admin/categories/${createdId}`}
              className="text-sm font-medium text-link underline-offset-4 hover:underline"
            >
              <AutoText>Open the new category</AutoText>
            </a>
          ) : null}
        </div>
      ) : null}
      {creating ? (
        <Checkbox
          id="category-isActive"
          name="isActive"
          defaultChecked={state.values === undefined ? true : state.values.isActive === 'on'}
          label={tx('Show in the storefront')}
          hint={tx('Hidden categories and their products never appear to shoppers.')}
        />
      ) : null}

      <div className="flex justify-end border-t border-hairline pt-5">
        <Button
          type="submit"
          loading={busy}
          disabled={pictureError !== null}
          className="max-sm:min-h-11 max-sm:w-full"
        >
          {upload.state.phase === 'processing'
            ? 'Saving…'
            : busy
              ? creating
                ? 'Creating…'
                : 'Saving…'
              : creating
                ? 'Create category'
                : 'Save category'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Moves a category one step earlier or later among its siblings (the categories under the same
 * parent). It sends the order the page is showing, so a stale page is refused, never guessed at.
 */
export function CategoryOrderButtons({
  csrf,
  category,
  parentId,
  groupIds,
  position,
}: {
  csrf: CsrfInput;
  category: Pick<AdminCategory, 'id' | 'name'>;
  parentId: string | null;
  groupIds: readonly string[];
  position: number;
}) {
  const [state, formAction, pending] = useActionState(moveCategoryAction, INITIAL_STATE);
  const only = groupIds.length < 2;
  return (
    <form action={formAction} className="inline-flex items-center gap-0.5">
      <CsrfField csrf={csrf} />
      <input type="hidden" name="categoryId" value={category.id} />
      <input type="hidden" name="parentId" value={parentId ?? ''} />
      <input type="hidden" name="order" value={groupIds.join(',')} />
      <Button
        type="submit"
        name="direction"
        value="earlier"
        variant="ghost"
        size="sm"
        disabled={only || position === 0 || pending}
        aria-label={`Move ${category.name} earlier`}
        className="max-sm:size-11"
      >
        <ChevronUp aria-hidden="true" strokeWidth={1.75} />
      </Button>
      <Button
        type="submit"
        name="direction"
        value="later"
        variant="ghost"
        size="sm"
        disabled={only || position === groupIds.length - 1 || pending}
        aria-label={`Move ${category.name} later`}
        className="max-sm:size-11"
      >
        <ChevronDown aria-hidden="true" strokeWidth={1.75} />
      </Button>
      {state.status === 'error' ? (
        <span role="alert" className="sr-only">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

/** Shows or hides a category, after confirmation (it hides every product in it). */
export function CategoryVisibilityForm({
  csrf,
  category,
  align = 'end',
}: {
  csrf: CsrfInput;
  category: Pick<AdminCategory, 'id' | 'name' | 'isActive' | 'productCount'>;
  align?: 'start' | 'end';
}) {
  const tx = useTx();
  const products =
    category.productCount === 1 ? 'its product' : `its ${String(category.productCount)} products`;
  return category.isActive ? (
    <ConfirmedAction
      action={setCategoryActiveAction}
      csrf={csrf}
      align={align}
      trigger={
        <>
          Hide{' '}
          <span className="sr-only">
            <AutoText value={category.name} />
          </span>
        </>
      }
      triggerVariant="ghost"
      title={`Hide “${category.name}”?`}
      description={`The category and ${category.productCount > 0 ? products : 'anything added to it'} disappear from the storefront until it is shown again. Orders already placed are not affected.`}
      confirmLabel={tx('Hide category')}
      hiddenFields={{ categoryId: category.id, active: 'false' }}
    />
  ) : (
    <ConfirmedAction
      action={setCategoryActiveAction}
      csrf={csrf}
      align={align}
      trigger={
        <>
          Show{' '}
          <span className="sr-only">
            <AutoText value={category.name} />
          </span>
        </>
      }
      triggerVariant="ghost"
      title={`Show “${category.name}” in the storefront?`}
      description={tx('The category appears again, with those of its products that are on sale.')}
      confirmLabel={tx('Show category')}
      tone="primary"
      hiddenFields={{ categoryId: category.id, active: 'true' }}
    />
  );
}
