'use client';

import { Button } from '@nilzora/ui';
import { Trash2 } from 'lucide-react';
import { useActionState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { PictureUploadForm } from '@/components/admin-kit/picture-upload-form';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import {
  removeCategoryBannerAction,
  removeCategoryImageAction,
  uploadCategoryBannerAction,
  uploadCategoryImageAction,
} from '@/lib/category-image-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/** What one of the two pictures is for, where it appears and what size suits it. */
function Guidance({ where, size }: { where: string; size: string }) {
  return (
    <dl className="grid gap-1 rounded-lg bg-neutral-soft/60 px-3 py-2 text-xs text-muted-foreground">
      <div className="flex gap-1.5">
        <dt className="font-semibold text-foreground">
          <AutoText>Appears</AutoText>:
        </dt>
        <dd>
          <AutoText>{where}</AutoText>
        </dd>
      </div>
      <div className="flex gap-1.5">
        <dt className="font-semibold text-foreground">
          <AutoText>Best size</AutoText>:
        </dt>
        <dd>
          <AutoText>{size}</AutoText>
        </dd>
      </div>
    </dl>
  );
}

/**
 * A category's logo: the small square picture that stands for it wherever it is listed (category
 * tiles, subcategory chips and menus). Shows the current one, replaces it (with a preview of the
 * chosen file and real upload progress) and removes it in a separate form. It is not the wide
 * picture at the top of the category page: that is the banner, below.
 */
export function CategoryImageForm({
  categoryId,
  imageUrl,
  csrf,
}: {
  categoryId: string;
  imageUrl: string | null;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, remove, removing] = useActionState(removeCategoryImageAction, IDLE_STATE);
  return (
    <div className="grid gap-4">
      <Guidance
        where="the small square tile for this category in lists, menus and subcategory chips"
        size="Square, at least 600 × 600 px. It is cropped to a square and shown small."
      />
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- from the media origin, not known to the build
        <img
          src={imageUrl}
          alt={tx("The category's current logo")}
          className="size-28 rounded-2xl border border-border object-cover"
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          <AutoText>No logo yet; customers see a plain icon tile instead.</AutoText>
        </p>
      )}
      <PictureUploadForm
        kind="category-image"
        idName="categoryId"
        idValue={categoryId}
        csrf={csrf}
        label={imageUrl ? 'Replace the logo' : 'Upload a logo'}
        action={uploadCategoryImageAction}
      />
      {imageUrl ? (
        <form action={remove} className="grid gap-2">
          <CsrfField csrf={csrf} />
          <input type="hidden" name="categoryId" value={categoryId} />
          <ActionFeedback state={state} />
          <div>
            <Button type="submit" variant="outline" size="sm" loading={removing}>
              <Trash2 aria-hidden="true" />
              {removing ? 'Removing…' : 'Remove logo'}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/**
 * A category's banner: the wide picture across the top of its own page on the website and in the
 * app. Shows the current banner, replaces it (with a preview and real upload progress) and removes
 * it. The logo is untouched; a category without a banner shows its logo cropped wide instead.
 */
export function CategoryBannerForm({
  categoryId,
  bannerUrl,
  csrf,
}: {
  categoryId: string;
  bannerUrl: string | null;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, remove, removing] = useActionState(removeCategoryBannerAction, IDLE_STATE);
  return (
    <div className="grid gap-4">
      <Guidance
        where="across the top of this category's page, on the website and in the app"
        size="Wide, 12:5 (for example 1200 × 500 px). Keep the main subject in the middle."
      />
      {bannerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- from the media origin, not known to the build
        <img
          src={bannerUrl}
          alt={tx("The category's current banner")}
          className="aspect-[12/5] w-full rounded-lg border border-border object-cover"
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          <AutoText>
            No banner yet; the page shows the logo cropped wide, or a plain brand band, at the top.
          </AutoText>
        </p>
      )}
      <PictureUploadForm
        kind="category-banner"
        idName="categoryId"
        idValue={categoryId}
        csrf={csrf}
        label={bannerUrl ? 'Replace the banner' : 'Upload a banner'}
        action={uploadCategoryBannerAction}
      />
      {bannerUrl ? (
        <form action={remove} className="grid gap-2">
          <CsrfField csrf={csrf} />
          <input type="hidden" name="categoryId" value={categoryId} />
          <ActionFeedback state={state} />
          <div>
            <Button type="submit" variant="outline" size="sm" loading={removing}>
              <Trash2 aria-hidden="true" />
              {removing ? 'Removing…' : 'Remove banner'}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
