import type { Route } from 'next';
import Link from 'next/link';
import { Avatar, type AvatarIdentity } from './avatar';
import { AutoText } from '@/components/i18n/translate';

export interface RailAccountProps {
  identity: AvatarIdentity & { role: string };
  /** The account's profile page, when this workspace has one. */
  profileHref?: Route | undefined;
}

/**
 * The signed-in account at the foot of the rail: avatar, name and role. Links to the
 * profile where the workspace has one. In the icon rail only the avatar remains, with
 * the name as its tooltip. Sign-out lives in the top bar's account menu.
 */
export function RailAccount({ identity, profileHref }: RailAccountProps) {
  const body = (
    <>
      <Avatar identity={identity} className="size-9" />
      <span className="nz-rail-label grid min-w-0 flex-1 text-left leading-tight">
        <span className="truncate text-sm font-medium text-sidebar-foreground">
          {identity.name}
        </span>
        <span className="truncate text-xs text-sidebar-muted"><AutoText value={identity.role} /></span>
      </span>
    </>
  );
  const classes =
    'nz-rail-item relative flex min-h-12 items-center gap-3 rounded-xl px-2 py-1.5 transition-colors';

  return profileHref ? (
    <Link
      href={profileHref}
      aria-label={`Your profile: ${identity.name}, ${identity.role}`}
      className={`${classes} hover:bg-white/7`}
    >
      {body}
    </Link>
  ) : (
    <div className={classes}><AutoText value={body} /></div>
  );
}
