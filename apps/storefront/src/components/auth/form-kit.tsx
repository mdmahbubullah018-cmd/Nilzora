import { Alert } from '@nilzora/ui';
// Type-only: the session package is server-only, so client code must not import its values.
import type { FormState } from '@nilzora/web-session';

/** A Server Action driven by useActionState. */
export type FormAction = (previous: FormState, formData: FormData) => Promise<FormState>;

/** What a form view receives from useActionState. */
export interface FormStatusProps {
  state: FormState;
  /** The bound action for `<form action>`; also posts the form when JavaScript is off. */
  formAction: (formData: FormData) => void;
  pending: boolean;
}

/** Name and value of the hidden CSRF input. The server page renders both. */
export interface CsrfField {
  name: string;
  token: string;
}

/** Defined locally (not imported from the session package) for the reason above. */
export const IDLE_STATE: FormState = { status: 'idle' };

export function CsrfInput({ csrf }: { csrf: CsrfField }) {
  return <input type="hidden" name={csrf.name} value={csrf.token} />;
}

/** The action's form-level message. Errors use role="alert" so they are announced at once. */
export function FormMessage({ state }: { state: FormState }) {
  if (!state.message) return null;
  return <Alert tone={state.status === 'success' ? 'success' : 'danger'}>{state.message}</Alert>;
}
