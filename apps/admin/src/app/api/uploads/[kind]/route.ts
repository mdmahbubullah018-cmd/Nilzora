import { PRODUCT_IMAGE_MAX_BYTES, PRODUCT_VIDEO_MAX_BYTES } from '@nilzora/contracts';
import { type FormState, formStateStatus, INITIAL_FORM_STATE } from '@nilzora/web-session';
import { NextResponse } from 'next/server';
import { uploadAvatarAction } from '@/lib/avatar-actions';
import { saveCategoryAction } from '@/lib/catalog-actions';
import { uploadCategoryBannerAction, uploadCategoryImageAction } from '@/lib/category-image-actions';
import { uploadProductImageAction } from '@/lib/image-actions';
import { uploadMediaAction } from '@/lib/media-actions';
import { uploadProductVideoAction } from '@/lib/video-actions';
import {
  uploadBannerImageAction,
  uploadBannerMobileImageAction,
  uploadBrandBannerAction,
  uploadBrandLogoAction,
} from '@/lib/merch-actions';
import { isUploadKind, RESPOND_AS_STATE, type UploadKind } from '@/lib/upload-routes';

/*
 * POST /api/uploads/:kind
 * -----------------------
 * The same upload the page's forms perform with a Server Action, reachable from the browser as
 * a plain request so it can report real byte progress (an XMLHttpRequest's upload events). It
 * runs the very same action: the origin and CSRF checks, the session, the file checks and the
 * API call all happen there, and only that action's fixed, non-secret messages come back. The
 * forms still work without JavaScript through the action itself.
 */

/**
 * Creates a category and attaches its picture in one request, so the picture's transfer shows
 * real progress on the create form. The category is saved first; if the picture then fails, the
 * answer says so plainly and carries the new category's id, because the category exists.
 */
async function createCategoryWithPicture(
  previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const created = await saveCategoryAction(previous, formData);
  if (created.status !== 'success') return created;
  const categoryId = created.values?.categoryId;
  if (categoryId === undefined) return created;

  const picture = new FormData();
  for (const [name, value] of formData.entries()) picture.append(name, value);
  picture.set('categoryId', categoryId);
  const stored = await uploadCategoryImageAction(previous, picture);
  if (stored.status === 'success') return created;
  return {
    status: 'error',
    message: `The category was created, but its picture was not saved: ${
      stored.message ?? 'the upload failed.'
    } Open the category to add the picture again.`,
    values: { categoryId },
  };
}

const ACTIONS: Record<UploadKind, (previous: FormState, formData: FormData) => Promise<FormState>> =
  {
    'product-image': uploadProductImageAction,
    'brand-logo': uploadBrandLogoAction,
    'brand-banner': uploadBrandBannerAction,
    'banner-image': uploadBannerImageAction,
    'banner-mobile-image': uploadBannerMobileImageAction,
    'category-image': uploadCategoryImageAction,
    'category-banner': uploadCategoryBannerAction,
    'category-create': createCategoryWithPicture,
    avatar: uploadAvatarAction,
    media: uploadMediaAction,
    'product-video': uploadProductVideoAction,
  };

/** The picture plus the form's small fields and the multipart framing. */
const MAX_REQUEST_BYTES = PRODUCT_IMAGE_MAX_BYTES + 256 * 1024;
/** A product video plus the same small fields. */
const MAX_VIDEO_REQUEST_BYTES = PRODUCT_VIDEO_MAX_BYTES + 256 * 1024;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function answer(state: FormState): NextResponse {
  // The same state the action chose, with a status that matches it: a refused form is not a 200.
  return NextResponse.json(state, {
    status: formStateStatus(state),
    headers: NO_STORE,
  });
}

function refusal(message: string, status: number): NextResponse {
  return NextResponse.json({ status: 'error', message }, { status, headers: NO_STORE });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ kind: string }> },
): Promise<NextResponse> {
  const { kind } = await context.params;
  if (!isUploadKind(kind)) return refusal('This upload is not available.', 404);

  const declared = Number(request.headers.get('content-length'));
  const limit = kind === 'product-video' ? MAX_VIDEO_REQUEST_BYTES : MAX_REQUEST_BYTES;
  if (Number.isFinite(declared) && declared > limit) {
    return refusal(
      kind === 'product-video'
        ? 'This video is larger than 40 MB. Choose a shorter or smaller one.'
        : 'This image is larger than 5 MB. Choose a smaller one.',
      413,
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return refusal('The upload could not be read. Reload the page and try again.', 400);
  }
  // The route, not the browser, decides that this call answers with a state.
  formData.set(RESPOND_AS_STATE, '1');

  const state = await ACTIONS[kind](INITIAL_FORM_STATE, formData);
  return answer(state);
}
