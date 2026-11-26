'use client';

import { Button, Field, Input } from '@nilzora/ui';
import { Save } from 'lucide-react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { saveImageSearchSettingsAction } from '@/lib/image-search-actions';

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" loading={pending} className="rounded-xl max-sm:min-h-11">
      {pending ? null : <Save aria-hidden="true" strokeWidth={1.75} />}
      Save settings
    </Button>
  );
}

export interface ImageSearchSettingsFormProps {
  enabled: boolean;
  similarityThreshold: number;
  maxResults: number;
  csrf: CsrfInput;
}

/**
 * The three settings an operator controls. The embedding model is shown beside the form and
 * is deliberately not editable here: it is what this API produces, and a value typed into a
 * browser could not change that.
 */
export function ImageSearchSettingsForm({
  enabled,
  similarityThreshold,
  maxResults,
  csrf,
}: ImageSearchSettingsFormProps) {
  const [state, action] = useActionState(saveImageSearchSettingsAction, IDLE_STATE);
  return (
    <form action={action} className="grid gap-4">
      <CsrfField csrf={csrf} />
      <label className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={
            state.values?.enabled === 'on' ||
            (state.values?.enabled === undefined && enabled)
          }
          className="mt-0.5 size-4 accent-primary-action"
        />
        <span className="grid gap-0.5">
          <span className="text-sm font-semibold">Image search is available to customers</span>
          <span className="text-xs text-muted-foreground">
            Switching it off hides the camera from the website and answers the app with
            &quot;not available&quot;. Nothing is deleted, and switching it back on restores it.
          </span>
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          id="image-search-threshold"
          label="Similarity threshold"
          hint="Cosine similarity a result needs to be shown. 0.70 measured best on the current catalogue; raise it for fewer, closer matches."
          error={state.fieldErrors?.similarityThreshold}
        >
          {(control) => (
            <Input
              {...control}
              name="similarityThreshold"
              type="number"
              min={0.3}
              max={0.99}
              step="0.01"
              inputMode="decimal"
              defaultValue={state.values?.similarityThreshold ?? String(similarityThreshold)}
              className="tabular-nums max-sm:h-11"
            />
          )}
        </Field>
        <Field
          id="image-search-max-results"
          label="Maximum results"
          hint="How many matching products a search may return, 1 to 120."
          error={state.fieldErrors?.maxResults}
        >
          {(control) => (
            <Input
              {...control}
              name="maxResults"
              type="number"
              min={1}
              max={120}
              step="1"
              inputMode="numeric"
              defaultValue={state.values?.maxResults ?? String(maxResults)}
              className="tabular-nums max-sm:h-11"
            />
          )}
        </Field>
      </div>
      <div>
        <SaveButton />
      </div>
      <ActionFeedback state={state} />
    </form>
  );
}
