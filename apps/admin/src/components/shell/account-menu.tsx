'use client';

import { ChevronDown, ImageUp } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useRef } from 'react';
import { useDetailsDismiss } from '@/components/admin-kit/use-details-dismiss';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { Avatar } from './avatar';
import { AutoText } from '@/components/i18n/translate';

export { initialsOf } from './avatar';

export interface AccountMenuProps {
  identity: {
    name: string;
    role: string;
    email?: string | null | undefined;
    /** The account's profile picture (thumbnail URL), when it has one. */
    avatarUrl?: string | null | undefined;
  };
  /** Where the account changes its picture, when this workspace has such a page. */
  profileHref?: Route | undefined;
  csrf: CsrfInput;
}

/**
 * The signed-in account in the top bar: avatar, name and role, opening a panel with
 * sign-out. A native <details>, so it opens and signs out without JavaScript; with
 * it, Escape and clicks outside close the panel.
 */
export function AccountMenu({ identity, csrf, profileHref }: AccountMenuProps) {
  const ref = useRef<HTMLDetailsElement>(null);
  const { onToggle } = useDetailsDismiss(ref);

  const showEmail = identity.email && identity.email !== identity.name;

  return (
    <details ref={ref} className="group relative" onToggle={onToggle}>
      <summary
        aria-label={`Account: ${identity.name}, ${identity.role}`}
        className="flex h-10 cursor-pointer list-none items-center gap-2.5 rounded-2xl border border-transparent px-1.5 transition-colors select-none hover:border-border/70 hover:bg-surface-muted sm:pr-2 [&::-webkit-details-marker]:hidden"
      >
        <Avatar identity={identity} />
        <span aria-hidden="true" className="hidden min-w-0 text-left leading-tight sm:grid">
          <span className="max-w-40 truncate text-sm font-semibold text-foreground">
            {identity.name}
          </span>
          <span className="truncate text-[11px] font-medium text-muted-foreground">
            <AutoText value={identity.role} />
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className="hidden size-4 text-muted-foreground transition-transform group-open:rotate-180 sm:block"
        />
      </summary>

      <div className="nz-glass absolute top-full right-0 z-40 mt-2 grid w-72 max-w-[calc(100vw-2rem)] gap-2 rounded-2xl border p-2">
        <div className="flex items-center gap-3 rounded-xl bg-surface-muted/60 p-2.5">
          <Avatar identity={identity} />
          <div className="grid min-w-0 gap-0.5">
            <p className="truncate text-sm font-semibold text-foreground">
              <AutoText value={identity.name} />
            </p>
            {showEmail ? (
              <p className="truncate text-xs text-muted-foreground">
                <AutoText value={identity.email} />
              </p>
            ) : null}
            <p className="text-[11px] font-medium text-muted-foreground">
              <AutoText value={identity.role} />
            </p>
          </div>
        </div>
        {profileHref ? (
          <Link
            href={profileHref}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
          >
            <ImageUp aria-hidden="true" className="size-4 text-muted-foreground" />
            <AutoText>Profile picture</AutoText>
          </Link>
        ) : null}
        <div className="border-t border-border/70 pt-2">
          <SignOutButton csrf={csrf} variant="outline" size="sm" className="grid" />
        </div>
      </div>
    </details>
  );
}
