'use client';

import { Field, Input } from '@nilzora/ui';
import { useState, type ReactNode } from 'react';
import { ConfirmForm, type ConfirmFormProps } from '@/components/admin-kit/confirm-form';
import { AutoText } from '@/components/i18n/translate';

/** A phrase as a pattern that matches only itself (for the native `pattern` attribute). */
export function exactPattern(phrase: string): string {
  // Hyphens and slashes stay as they are: escaping them is invalid in the browser's
  // unicode-sets pattern mode, and they match themselves outside a class anyway.
  return phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface TypedConfirmFormProps extends Omit<ConfirmFormProps, 'children'> {
  /** What the person must type, e.g. "VERIFY STEADFAST". Sent as `confirmation`. */
  phrase: string;
  /** A message from the last attempt about the typed phrase. */
  phraseError?: string | undefined;
  /** Extra fields before the phrase. */
  children?: ReactNode;
}

/**
 * A ConfirmForm for sensitive switches: the second step asks for the phrase to be typed
 * exactly (the browser checks the pattern, and the Server Action and the API check again).
 */
export function TypedConfirmForm({
  phrase,
  phraseError,
  children,
  ...props
}: TypedConfirmFormProps) {
  const [typed, setTyped] = useState('');
  const id = `confirm-${phrase.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <ConfirmForm {...props}>
      {children}
      <Field
        id={id}
        label={
          <>
            Type{' '}
            <span className="font-mono font-semibold">
              <AutoText value={phrase} />
            </span>{' '}
            to confirm
          </>
        }
        error={phraseError}
        hint={typed && typed !== phrase ? 'The phrase does not match yet.' : undefined}
        required
      >
        {(control) => (
          <Input
            {...control}
            name="confirmation"
            autoComplete="off"
            spellCheck={false}
            required
            pattern={exactPattern(phrase)}
            value={typed}
            onChange={(event) => setTyped(event.currentTarget.value)}
            className="font-mono"
          />
        )}
      </Field>
    </ConfirmForm>
  );
}
