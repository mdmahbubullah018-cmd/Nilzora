/** Thrown by the mocked `redirect` so tests can see where a page or action sent the visitor. */
export class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super(`redirect to ${url}`);
  }
}

export function throwRedirect(url: string): never {
  throw new RedirectSignal(url);
}

/** Thrown by the mocked `notFound`, with the digest Next's own not-found error carries. */
export class NotFoundSignal extends Error {
  readonly digest = 'NEXT_NOT_FOUND';
}

export function throwNotFound(): never {
  throw new NotFoundSignal();
}
