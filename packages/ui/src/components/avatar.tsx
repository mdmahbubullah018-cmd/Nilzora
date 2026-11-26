import { cn } from '../lib/cn';

/*
 * The account picture, in the one place every web surface reads it from.
 *
 * The order is always the same — the customer's own upload, then the picture their Google
 * account supplied, then their initials — and the initials get a colour that never changes
 * for that account, so the same person is the same blue (or green, or amber) on every screen
 * and every reload. The tones are the brand's own supporting colours, each paired with a
 * foreground that keeps the initials above 4.5:1.
 */

/** Up to two initials from a name or email address. */
export function initialsOf(name: string): string {
  const words = name
    .replace(/@.*$/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = words.length > 1 ? [words[0], words.at(-1)] : [words[0]];
  const initials = letters
    .map((word) => (word ? Array.from(word)[0] : ''))
    .join('')
    .toUpperCase();
  return initials === '' ? 'N' : initials;
}

/** The generated-avatar tones: a stable colour per account, from the brand's palette. */
const TONES = [
  'bg-primary/12 text-primary ring-primary/25',
  'bg-brand-violet/12 text-brand-violet ring-brand-violet/25',
  'bg-success/12 text-success ring-success/25',
  'bg-warning/15 text-warning ring-warning/30',
  'bg-brand-sky/15 text-primary ring-brand-sky/30',
  'bg-brand-slate/12 text-brand-slate ring-brand-slate/25',
] as const;

/**
 * The tone for one account: the same seed always picks the same colour, and two accounts
 * with the same initials are not forced to share it.
 */
export function avatarTone(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100_000;
  }
  return TONES[hash % TONES.length] ?? TONES[0];
}

export interface AvatarProps {
  /** The name (or email) the initials come from, and the seed for their colour. */
  name: string;
  /** The customer's own upload, then Google's picture; the initials show when both are absent. */
  url?: string | null | undefined;
  /** The account whose colour is used; defaults to the name. */
  seed?: string | undefined;
  className?: string;
}

/**
 * The account's picture, or its initials. Decorative: every caller shows the name beside it,
 * so announcing this too would only repeat.
 */
export function Avatar({ name, url = null, seed, className }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-10 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-semibold ring-1',
        url === null ? avatarTone(seed ?? name) : 'bg-surface-muted ring-border',
        className,
      )}
    >
      {url === null ? (
        initialsOf(name)
      ) : (
        // A plain img: the address is the media origin's or Google's, neither known to this build.
        <img src={url} alt="" className="size-full object-cover" loading="lazy" decoding="async" />
      )}
    </span>
  );
}
