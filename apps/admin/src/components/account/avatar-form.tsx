'use client';

import { Button } from '@nilzora/ui';
import { Trash2 } from 'lucide-react';
import { useActionState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { PictureUploadForm } from '@/components/admin-kit/picture-upload-form';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { removeAvatarAction, uploadAvatarAction } from '@/lib/avatar-actions';
import { initialsOf } from '@/components/shell/account-menu';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/**
 * The signed-in account's own picture: the current one (or initials), a form that replaces it
 * with a preview and real upload progress, and a separate form that removes it. Neither form
 * names an account; the API changes the one the session belongs to.
 */
export function AvatarForm({
  name,
  avatarUrl,
  csrf,
}: {
  name: string;
  avatarUrl: string | null;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [state, remove, removing] = useActionState(removeAvatarAction, IDLE_STATE);
  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-4">
        <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full bg-workspace-accent/15 text-xl font-semibold text-foreground ring-1 ring-workspace-accent/40">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- from the media origin, not known to the build
            <img
              src={avatarUrl}
              alt={tx('Your current profile picture')}
              className="size-full object-cover"
            />
          ) : (
            <span aria-hidden="true">
              <AutoText value={initialsOf(name)} />
            </span>
          )}
        </span>
        <p className="text-sm text-muted-foreground">
          Shown in the top bar next to your name.{' '}
          {avatarUrl ? '' : 'You have not set a picture yet.'}
        </p>
      </div>
      <PictureUploadForm
        kind="avatar"
        csrf={csrf}
        label={avatarUrl ? 'Replace your picture' : 'Upload a picture'}
        action={uploadAvatarAction}
      />
      {avatarUrl ? (
        <form action={remove} className="grid gap-2">
          <CsrfField csrf={csrf} />
          <ActionFeedback state={state} />
          <div>
            <Button
              type="submit"
              variant="outline"
              size="sm"
              loading={removing}
              className="rounded-xl max-sm:min-h-11"
            >
              <Trash2 aria-hidden="true" strokeWidth={1.75} />
              {removing ? 'Removing…' : 'Remove picture'}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
