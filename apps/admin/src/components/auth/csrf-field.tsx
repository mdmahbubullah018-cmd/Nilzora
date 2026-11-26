/** The CSRF field a state-changing form must carry, rendered by the server for this browser. */
export interface CsrfInput {
  name: string;
  token: string;
}

export function CsrfField({ csrf }: { csrf: CsrfInput }) {
  return <input type="hidden" name={csrf.name} value={csrf.token} />;
}
