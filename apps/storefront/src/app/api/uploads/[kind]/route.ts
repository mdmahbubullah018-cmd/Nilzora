import { AVATAR_MAX_BYTES, PRODUCT_IMAGE_MAX_BYTES } from '@nilzora/contracts';
import { type FormState, formStateStatus } from '@nilzora/web-session';
import { NextResponse } from 'next/server';
import { uploadAvatarAction, uploadReviewPhotoAction } from '@/lib/picture-actions';

/*
 * POST /api/uploads/:kind
 * -----------------------
 * The same uploads the pages' forms perform with a Server Action, reachable from the browser as
 * a plain request so it can report real byte progress (an XMLHttpRequest's upload events). The
 * request runs the very same action: the origin and CSRF checks, the session, the file checks
 * and the API call all happen there, and only that action's fixed, non-secret messages come
 * back. A request needs a signed-in session; the API decides whose picture it is from that
 * session, never from anything in the request.
 */

const ACTIONS = {
  avatar: uploadAvatarAction,
  'review-photo': uploadReviewPhotoAction,
} satisfies Record<string, (previous: FormState, formData: FormData) => Promise<FormState>>;

type Kind = keyof typeof ACTIONS;

function isKind(value: string): value is Kind {
  return Object.hasOwn(ACTIONS, value);
}

/** The picture plus the form's small fields and the multipart framing. */
const FRAMING = 256 * 1024;
const MAX_REQUEST_BYTES = PRODUCT_IMAGE_MAX_BYTES + FRAMING;
const MAX_AVATAR_REQUEST_BYTES = AVATAR_MAX_BYTES + FRAMING;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function answer(state: FormState, status = formStateStatus(state)): NextResponse {
  // The same state the action chose, with a status that matches it: a refused form is not a 200.
  return NextResponse.json(state, { status, headers: NO_STORE });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ kind: string }> },
): Promise<NextResponse> {
  const { kind } = await context.params;
  if (!isKind(kind)) {
    return answer({ status: 'error', message: 'This upload is not available.' }, 404);
  }

  const limit = kind === 'avatar' ? MAX_AVATAR_REQUEST_BYTES : MAX_REQUEST_BYTES;
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    return answer(
      {
        status: 'error',
        message:
          kind === 'avatar'
            ? 'This picture is larger than 3 MB. Choose a smaller one.'
            : 'This picture is larger than 5 MB. Choose a smaller one.',
      },
      413,
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return answer(
      { status: 'error', message: 'The upload could not be read. Reload the page and try again.' },
      400,
    );
  }
  return answer(await ACTIONS[kind]({ status: 'idle' }, formData));
}
