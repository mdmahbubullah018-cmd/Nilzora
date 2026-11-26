import { cn } from '@nilzora/ui';

/** Up to two initials from a name or email address, for the avatar (display only). */
export function initialsOf(name: string): string {
  const words = name
    .replace(/@.*$/, '')
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = words.length > 1 ? [words[0], words.at(-1)] : [words[0]];
  return letters
    .map((word) => (word ? Array.from(word)[0] : ''))
    .join('')
    .toUpperCase();
}

export interface AvatarIdentity {
  name: string;
  /** The account's profile picture (thumbnail URL), when it has one. */
  avatarUrl?: string | null | undefined;
}

/** The account's picture, or its initials until it has one. Decorative: the name is beside it. */
export function Avatar({ identity, className }: { identity: AvatarIdentity; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-workspace-accent/15 text-xs font-semibold text-foreground ring-1 ring-workspace-accent/40',
        className,
      )}
    >
      {identity.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- from the media origin, not known to the build
        <img src={identity.avatarUrl} alt="" className="size-full object-cover" />
      ) : (
        initialsOf(identity.name)
      )}
    </span>
  );
}
