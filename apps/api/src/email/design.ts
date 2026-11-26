/*
 * The Nilzora email design family
 * -------------------------------
 * Shared building blocks for every email the API sends (account emails in auth/emails.ts,
 * order emails in modules/order-emails). One look across all of them:
 *
 *  - a white page, a ≤600px column and no boxed card or drop shadow: content sits on the page
 *    and sections are separated by hairline rules, which renders the same in every client;
 *  - navy type, slate body copy and the brand blue used sparingly (the wordmark, links,
 *    small accents) rather than as large blocks;
 *  - the official logo only when `EMAIL_LOGO_URL` is configured, otherwise the wordmark set in
 *    text in its brand colours, never a redrawn logo; links only from a configured site URL;
 *  - table layout with inline styles and system font fallbacks, which is what email clients
 *    actually render; every image carries alt text and every message a plain-text part.
 */

/** Brand colours from the shared design tokens. */
export const BRAND = {
  navy: '#0F172A',
  slate: '#334155',
  muted: '#CBD5E1',
  soft: '#F1F5F9',
  sky: '#38BDF8',
  primary: '#0284C7',
  pressed: '#0369A1',
  violet: '#8B5CF6',
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  surface: '#FFFFFF',
  /** Hairline rules: lighter than the muted slate so they separate without boxing. */
  rule: '#E2E8F0',
  /** Body copy on white: slate at full strength keeps well above 4.5:1. */
  body: '#334155',
  /** Small print: still 7:1 on white. */
  small: '#475569',
} as const;

export const FONT = "'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
export const MONO = "'SFMono-Regular',Consolas,'Liberation Mono','Courier New',monospace";

export interface EmailBranding {
  /** Public URL of the official artwork. Omitted → the wordmark is set in text. */
  logoUrl?: string | undefined;
  /** Public address of the storefront. Omitted → no button or link is rendered. */
  siteUrl?: string | undefined;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function configured(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text === undefined || text === '' ? undefined : text;
}

/** An http(s) URL with a trailing path, or undefined: a bad setting renders no link at all. */
export function safeUrl(value: string | undefined, path = ''): string | undefined {
  const text = configured(value);
  if (text === undefined) return undefined;
  try {
    const url = new URL(path, text.endsWith('/') ? text : `${text}/`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Only absolute https images are put in an email; anything else renders nothing. */
export function safeImageUrl(value: string | null | undefined): string | undefined {
  const text = configured(value ?? undefined);
  if (text === undefined) return undefined;
  try {
    return new URL(text).protocol === 'https:' ? text : undefined;
  } catch {
    return undefined;
  }
}

export function header(branding: EmailBranding): string {
  const logo = configured(branding.logoUrl);
  if (logo !== undefined) {
    return `<img src="${escapeHtml(logo)}" alt="Nilzora" height="32" style="height:32px;width:auto;display:block;border:0;outline:none;text-decoration:none;" />`;
  }
  // The wordmark in its brand colours ("Nil" navy, "zora" blue), set in text.
  return `<span style="font-family:${FONT};font-size:22px;font-weight:700;letter-spacing:-0.5px;line-height:32px;"><span style="color:${BRAND.navy};">Nil</span><span style="color:${BRAND.primary};">zora</span></span>`;
}

export function paragraph(html: string, margin = '0 0 14px 0'): string {
  return `<p style="margin:${margin};font-family:${FONT};font-size:15px;line-height:24px;color:${BRAND.body};">${html}</p>`;
}

/** A small uppercase label above a section. */
export function eyebrow(text: string, margin = '0 0 8px 0'): string {
  return `<p style="margin:${margin};font-family:${FONT};font-size:11px;line-height:16px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${BRAND.small};">${escapeHtml(text)}</p>`;
}

/** A hairline that separates sections. */
export function rule(margin = '20px 0'): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:${margin};"><tr><td style="height:1px;line-height:1px;font-size:0;background:${BRAND.rule};">&nbsp;</td></tr></table>`;
}

/**
 * A bulletproof button (table cell + link), rendered only for a real link. Navy, not a large
 * blue block, with the label in white for 15:1 contrast.
 */
export function button(label: string, href: string | undefined): string {
  if (href === undefined) return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px 0;">
<tr><td style="background:${BRAND.navy};border-radius:10px;">
<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:14px;font-weight:600;line-height:20px;color:#FFFFFF;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
</td></tr>
</table>`;
}

/** A quiet note: a thin coloured edge and plain type, never colour alone. */
export function notice(title: string, html: string, edge: string = BRAND.muted): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0;">
<tr><td style="border-left:2px solid ${edge};padding:2px 0 2px 14px;font-family:${FONT};font-size:13px;line-height:20px;color:${BRAND.small};">
<strong style="display:block;margin:0 0 2px 0;color:${BRAND.navy};font-size:13px;">${escapeHtml(title)}</strong>${html}
</td></tr>
</table>`;
}

/** Two columns of label/value rows (totals, order facts). Values are already-escaped HTML. */
export function keyValueRows(
  rows: readonly { label: string; value: string; strong?: boolean }[],
): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${rows
  .map(
    (row) => `<tr>
<td style="padding:4px 0;font-family:${FONT};font-size:14px;line-height:21px;color:${row.strong ? BRAND.navy : BRAND.small};${row.strong ? 'font-weight:700;' : ''}">${escapeHtml(row.label)}</td>
<td align="right" style="padding:4px 0;font-family:${FONT};font-size:14px;line-height:21px;color:${BRAND.navy};${row.strong ? 'font-weight:700;font-size:16px;' : ''}">${row.value}</td>
</tr>`,
  )
  .join('\n')}
</table>`;
}

/**
 * The shared skeleton: a hidden preheader, the brand header over a hairline, the heading and
 * body on the white page, and a footer that says why the message was sent.
 */
export function layout(
  branding: EmailBranding,
  options: { heading: string; preheader: string; body: string; reason: string },
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>Nilzora</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.surface};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(options.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.surface};">
<tr><td align="center" style="padding:28px 16px 32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td style="padding:0 0 18px 0;border-bottom:1px solid ${BRAND.rule};">${header(branding)}</td></tr>
<tr><td style="padding:28px 0 8px 0;">
<h1 style="margin:0 0 14px 0;font-family:${FONT};font-size:22px;line-height:30px;font-weight:700;letter-spacing:-0.3px;color:${BRAND.navy};">${escapeHtml(options.heading)}</h1>
${options.body}
</td></tr>
<tr><td style="padding:18px 0 0 0;border-top:1px solid ${BRAND.rule};font-family:${FONT};font-size:12px;line-height:18px;color:${BRAND.small};">
<p style="margin:0 0 6px 0;">${escapeHtml(options.reason)}</p>
<p style="margin:0;">Nilzora · This is an automated message; replies are not read.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** "Hi Rafi," from the account name's first word, or "Hi," without one. */
export function greeting(name: string | null | undefined): string {
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : 'Hi,';
}
