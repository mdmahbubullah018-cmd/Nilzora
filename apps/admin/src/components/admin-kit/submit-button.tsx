'use client';

import { Button, type ButtonProps } from '@nilzora/ui';
import { useFormStatus } from 'react-dom';

export interface SubmitButtonProps extends Omit<ButtonProps, 'type' | 'loading'> {
  /** What the button says while its form is being sent, e.g. "Recording…". */
  pendingLabel?: string;
}

/**
 * The submit button of a form that runs a Server Action: while that form is being sent it shows
 * a spinner, says what is happening, and cannot be pressed again, so one click is one request.
 * It must sit inside the form it belongs to (useFormStatus reads the nearest parent form).
 */
export function SubmitButton({ pendingLabel, children, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} {...props}>
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
