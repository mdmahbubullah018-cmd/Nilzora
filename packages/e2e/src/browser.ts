/**
 * A minimal browser for end-to-end tests: keeps cookies like a browser would (per
 * name; Max-Age=0 deletes), sends a fixed client address, and submits forms exactly
 * as a browser without JavaScript does (React renders Server Action forms so that a
 * plain multipart POST to the page works). Every response body is kept so tests can
 * assert that no token ever reached the browser.
 */

export interface SetCookie {
  name: string;
  value: string;
  /** Lower-cased attribute names; flags map to true. */
  attributes: Record<string, string | true>;
}

export function parseSetCookie(header: string): SetCookie {
  const [pair = '', ...parts] = header.split(';');
  const separator = pair.indexOf('=');
  const attributes: Record<string, string | true> = {};
  for (const part of parts) {
    const [key = '', ...rest] = part.trim().split('=');
    attributes[key.toLowerCase()] = rest.length > 0 ? rest.join('=') : true;
  }
  return {
    name: pair.slice(0, separator).trim(),
    value: pair.slice(separator + 1).trim(),
    attributes,
  };
}

export interface Page {
  status: number;
  location: string | null;
  html: string;
  setCookies: SetCookie[];
  headers: Headers;
}

const ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
};

function decode(value: string): string {
  return value.replace(/&(quot|#x27|#39|lt|gt|amp);/g, (entity) => ENTITIES[entity] ?? entity);
}

function attributesOf(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.$]*)(?:="([^"]*)")?/g)) {
    const [, name = '', value = ''] = match;
    attributes[name.toLowerCase()] = decode(value);
  }
  return attributes;
}

export interface ParsedForm {
  id: string | undefined;
  action: string | undefined;
  fields: [string, string][];
  buttons: string[];
  html: string;
}

/** Forms in server-rendered HTML with their input values (hidden ones included). */
export function formsIn(html: string): ParsedForm[] {
  const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map((match) => {
    const [, formTag = '', body = ''] = match;
    const fields: [string, string][] = [];
    for (const input of body.matchAll(/<input\b([^>]*?)\/?>/g)) {
      const attributes = attributesOf(input[1] ?? '');
      if (!attributes.name || 'disabled' in attributes) continue;
      if (['submit', 'button', 'checkbox', 'radio'].includes(attributes.type ?? '')) continue;
      fields.push([attributes.name, attributes.value ?? '']);
    }
    const buttons = [...body.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((button) =>
      decode((button[1] ?? '').replace(/<[^>]+>/g, '')).trim(),
    );
    return {
      id: attributesOf(formTag).id,
      action: attributesOf(formTag).action,
      fields,
      buttons,
      html: body,
    };
  });
  // Controls may live outside their form and name it with `form="<id>"` (the product
  // editor's sections do, with a hidden form holding only the CSRF token). A browser
  // submits every associated control, so the harness collects them too.
  for (const input of html.matchAll(/<input\b([^>]*?)\/?>/g)) {
    const attributes = attributesOf(input[1] ?? '');
    const owner = attributes.form;
    if (!owner || !attributes.name || 'disabled' in attributes) continue;
    if (['submit', 'button', 'checkbox', 'radio', 'file'].includes(attributes.type ?? '')) continue;
    const target = forms.find((form) => form.id === owner);
    if (!target) continue;
    if (target.fields.some(([name]) => name === attributes.name)) continue;
    target.fields.push([attributes.name, attributes.value ?? '']);
  }
  // A submit button may sit outside its form and name it with `form="<id>"` (the product
  // editor's sticky action bar does). A browser submits that form, so the harness must
  // treat the button as the form's own.
  for (const button of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const owner = attributesOf(button[1] ?? '').form;
    if (!owner) continue;
    const target = forms.find((form) => form.id === owner);
    if (!target) continue;
    const text = decode((button[2] ?? '').replace(/<[^>]+>/g, '')).trim();
    if (text !== '' && !target.buttons.includes(text)) target.buttons.push(text);
  }
  return forms;
}

/** The page's referrer policy: a `Referrer-Policy` header, overridden by a meta tag. */
export function referrerPolicyOf(page: Page): string | undefined {
  let policy = page.headers.get('referrer-policy')?.split(',').pop()?.trim();
  for (const meta of page.html.matchAll(/<meta\b([^>]*)>/g)) {
    const attributes = attributesOf(meta[1] ?? '');
    if (attributes.name?.toLowerCase() === 'referrer' && attributes.content) {
      policy = attributes.content.trim().toLowerCase();
    }
  }
  return policy;
}

let addressCounter = 0;

/** A distinct documentation-range address per browser, so rate limits do not overlap. */
function nextAddress(): string {
  addressCounter += 1;
  const salt = Math.floor(Math.random() * 200);
  return `198.51.${(salt + addressCounter) % 250}.${((addressCounter * 7 + salt) % 250) + 1}`;
}

export interface SubmitOptions {
  /**
   * Origin header to send; null sends none. Defaults to what a browser sends for a
   * same-origin form post from the page: its own origin, or `null` when the page's
   * referrer policy is `no-referrer` (Fetch standard, "append a request Origin header").
   */
  origin?: string | null;
  /** Fields to remove before posting (e.g. the CSRF token). */
  drop?: string[];
  /** Reuse an already fetched page instead of loading it again. */
  page?: Page;
}

export class TestBrowser {
  readonly cookies = new Map<string, string>();
  readonly bodies: string[] = [];
  readonly address: string;

  constructor(
    readonly origin: string,
    address?: string,
  ) {
    this.address = address ?? nextAddress();
  }

  async go(
    path: string,
    init: { method?: string; body?: FormData; headers?: Record<string, string> } = {},
  ): Promise<Page> {
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) {
      headers.set(
        'cookie',
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    }
    headers.set('x-forwarded-for', this.address);
    const response = await fetch(new URL(path, this.origin), {
      method: init.method ?? 'GET',
      body: init.body,
      headers,
      redirect: 'manual',
    });
    const html = await response.text();
    const setCookies = response.headers.getSetCookie().map(parseSetCookie);
    for (const cookie of setCookies) {
      if (cookie.attributes['max-age'] === '0' || cookie.value === '')
        this.cookies.delete(cookie.name);
      else this.cookies.set(cookie.name, cookie.value);
    }
    this.bodies.push(html);
    return {
      status: response.status,
      location: response.headers.get('location'),
      html,
      setCookies,
      headers: response.headers,
    };
  }

  /**
   * Fills and posts the first form on `path` that has the given field (or button text),
   * as a browser without JavaScript would.
   */
  async submit(
    path: string,
    match: { field?: string; button?: string },
    values: Record<string, string>,
    options: SubmitOptions = {},
  ): Promise<Page> {
    const page = options.page ?? (await this.go(path));
    const form = formsIn(page.html).find(
      (candidate) =>
        (match.field === undefined ||
          candidate.fields.some(([name]) => name === match.field) ||
          candidate.html.includes(`name="${match.field}"`)) &&
        (match.button === undefined ||
          candidate.buttons.some((text) => text.includes(match.button ?? ''))),
    );
    if (!form) throw new Error(`No matching form on ${path} (status ${page.status})`);

    const body = new FormData();
    for (const [name, value] of form.fields) body.append(name, value);
    for (const [name, value] of Object.entries(values)) body.set(name, value);
    for (const name of options.drop ?? []) body.delete(name);

    const base = new URL(path, this.origin);
    const target =
      form.action && !form.action.startsWith('javascript:') ? new URL(form.action, base) : base;
    const headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' };
    const pageOrigin = referrerPolicyOf(page) === 'no-referrer' ? 'null' : this.origin;
    if (options.origin !== null) headers.origin = options.origin ?? pageOrigin;
    return this.go(`${target.pathname}${target.search}`, { method: 'POST', body, headers });
  }
}
