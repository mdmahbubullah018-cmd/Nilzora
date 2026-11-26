'use client';

import {
  Alert,
  Button,
  Field,
  Input,
  SelectedImagePreview,
  UploadProgress,
  useProgressUpload,
} from '@nilzora/ui';
import { AVATAR_MIN_SIZE, checkReportedAvatar } from '@nilzora/contracts';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useRef, useState } from 'react';
import { removeAvatarAction, uploadAvatarAction } from '@/lib/picture-actions';
import { CsrfInput, FormMessage, IDLE_STATE, type CsrfField } from '../auth/form-kit';

const UPLOAD_ROUTE = '/api/uploads/avatar';

/**
 * The customer's own profile picture: the current one (or initials), a form that replaces it
 * with a preview and real upload progress, and a separate form that removes it. Neither form
 * names an account; the API changes the one the session belongs to. With JavaScript the picture
 * goes to the upload route (real byte progress); without it the form posts to the Server Action.
 */
export function AvatarForm({
  csrf,
  avatarUrl,
  googleAvatarUrl = null,
  initials,
}: {
  csrf: CsrfField;
  avatarUrl: string | null;
  /** The picture Google supplied; shown until the customer uploads one of their own. */
  googleAvatarUrl?: string | null;
  initials: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(uploadAvatarAction, IDLE_STATE);
  const [removed, removeAction, removing] = useActionState(removeAvatarAction, IDLE_STATE);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const upload = useProgressUpload({
    endpoint: UPLOAD_ROUTE,
    onSuccess: () => {
      formRef.current?.reset();
      setFile(null);
      router.refresh();
    },
  });
  const busy = pending || upload.busy;
  const imageError = fileError ?? state.fieldErrors?.image;
  // What the form is showing now: the upload, then Google's picture, then the initials.
  const shown = avatarUrl ?? googleAvatarUrl;
  const fromGoogle = avatarUrl === null && googleAvatarUrl !== null;

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-4">
        <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full bg-sky-50 font-display text-xl font-semibold text-primary ring-1 ring-sky-200">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- from the media origin or Google, not known to the build
            <img
              src={shown}
              alt={fromGoogle ? 'Your Google profile picture' : 'Your profile picture'}
              className="size-full object-cover"
            />
          ) : (
            <span aria-hidden="true">{initials}</span>
          )}
        </span>
        <p className="text-sm text-muted-foreground">
          {fromGoogle
            ? 'This is the picture on your Google account. Add your own to replace it.'
            : avatarUrl
              ? 'This is the picture on your account.'
              : 'You have not added a picture yet. Your initials are shown instead.'}
        </p>
      </div>

      <form
        ref={formRef}
        action={formAction}
        onSubmit={(event) => {
          // No file, or one that fails the quick checks: let the Server Action explain.
          if (!file || fileError !== null) return;
          event.preventDefault();
          upload.send(event.currentTarget, file);
        }}
        className="grid gap-3"
      >
        <CsrfInput csrf={csrf} />
        {upload.state.phase === 'idle' ? <FormMessage state={state} /> : null}
        <Field
          id="avatar-file"
          label={avatarUrl ? 'Choose a new picture' : 'Choose a picture'}
          error={imageError}
          hint={`JPEG, PNG or WebP, at least ${String(AVATAR_MIN_SIZE)} px on the shorter side, up to 3 MB.`}
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
                setFile(picked);
                setFileError(picked ? checkReportedAvatar(picked) : null);
                upload.reset();
              }}
            />
          )}
        </Field>
        {file && fileError === null && upload.state.phase === 'idle' ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <SelectedImagePreview file={file} />
            <span className="min-w-0 truncate">{file.name}</span>
          </div>
        ) : null}
        <UploadProgress
          state={upload.state}
          onCancel={upload.cancel}
          onRetry={() => {
            if (file && formRef.current) upload.send(formRef.current, file);
          }}
        />
        <div>
          <Button type="submit" loading={busy} disabled={fileError !== null}>
            {upload.state.phase === 'processing'
              ? 'Saving picture…'
              : busy
                ? 'Uploading…'
                : 'Save picture'}
          </Button>
        </div>
      </form>

      {avatarUrl ? (
        <form action={removeAction} className="grid gap-2">
          <CsrfInput csrf={csrf} />
          {removed.status === 'error' ? <Alert tone="danger">{removed.message}</Alert> : null}
          <div>
            <Button type="submit" variant="outline" size="sm" loading={removing} disabled={busy}>
              <Trash2 aria-hidden="true" />
              {removing ? 'Removing…' : 'Remove picture'}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
