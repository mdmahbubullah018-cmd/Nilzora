import { Alert, cn } from '@nilzora/ui';
// Type-only: erased at build time, so no server code reaches the browser.
import type { FormState } from '@nilzora/web-session';

/** The idle state every admin form starts from (useActionState's initial state). */
export const IDLE_STATE: FormState = { status: 'idle' };

export interface ActionFeedbackProps {
  state: FormState;
  /** Leave out failures, e.g. when a ConfirmForm already shows them in its panel. */
  successOnly?: boolean;
  /** A compact line instead of an Alert, for table rows and tight spaces. */
  inline?: boolean;
  className?: string;
}

/**
 * The outcome of the last submission of an admin form: a success or failure message
 * chosen by the Server Action (fixed text, never API output). Renders nothing while idle.
 */
export function ActionFeedback({
  state,
  successOnly = false,
  inline = false,
  className,
}: ActionFeedbackProps) {
  if (!state.message) return null;
  const success = state.status === 'success';
  if (!success && (successOnly || state.status !== 'error')) return null;

  if (inline) {
    return (
      <p
        role={success ? 'status' : 'alert'}
        className={cn(
          'text-xs font-medium whitespace-normal',
          success ? 'text-success-ink' : 'text-danger-ink',
          className,
        )}
      >
        {state.message}
      </p>
    );
  }
  return (
    <Alert tone={success ? 'success' : 'danger'} className={className}>
      {state.message}
    </Alert>
  );
}
