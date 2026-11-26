'use client';

import type { Permission } from '@nilzora/contracts';
import { Button, buttonClasses, cn, Dialog, Logo } from '@nilzora/ui';
import { ArrowLeftRight, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useInteractive } from '@/components/admin-kit/use-interactive';
import { workspaces, type NavBadge, type Workspace } from '@/lib/navigation';
import { QuickSearch, type QuickSearchScope } from './quick-search';
import { SidebarNav } from './sidebar-nav';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

export interface MobileNavProps {
  workspace: Workspace;
  /** The verified account's permissions; they only decide which links are listed. */
  permissions: readonly Permission[];
  /** The other workspace, set only when the account may enter it. */
  switchTo?: Workspace | undefined;
  identity: { name: string; role: string };
  /** The lists the phone search can look in, passed down from the shell. */
  scopes?: readonly QuickSearchScope[];
  /** Counts the shell read for this request, shown beside their destinations. */
  badges?: Partial<Record<NavBadge, ReactNode>>;
}

const switchLink =
  'flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium text-body transition-colors hover:bg-surface-muted hover:text-foreground';

/**
 * Navigation on phones and tablets. Without JavaScript (and until the page is
 * interactive) it is a native <details> disclosure that opens a sheet under the top
 * bar; once interactive it becomes a modal side sheet that traps focus and closes on
 * Escape, a click outside or a navigation.
 */
export function MobileNav({
  workspace,
  permissions,
  switchTo,
  identity,
  scopes = [],
  badges,
}: MobileNavProps) {
  const tx = useTx();
  const interactive = useInteractive();
  const [open, setOpen] = useState(false);
  const config = workspaces[workspace];
  const other = switchTo ? workspaces[switchTo] : undefined;
  const close = () => setOpen(false);

  const content = (onNavigate?: () => void) => (
    <>
      {scopes.length > 0 ? (
        <div className="pb-2">
          <QuickSearch
            scopes={scopes}
            inline
            label={tx("Search from the navigation")}
            onSubmitted={onNavigate}
          />
        </div>
      ) : null}
      <SidebarNav
        workspace={workspace}
        permissions={permissions}
        tone="light"
        onNavigate={onNavigate}
        badges={badges}
      />
      <div className="grid gap-1 border-t border-border pt-4">
        {other ? (
          <Link href={other.home} onClick={onNavigate} className={switchLink}>
            <ArrowLeftRight aria-hidden="true" className="size-4" />
            {other.name} workspace
          </Link>
        ) : null}
        <p className="grid px-3 pt-2 text-xs text-muted-foreground">
          <span><AutoText>Signed in as</AutoText></span>
          <span className="truncate text-sm font-medium text-foreground"><AutoText value={identity.name} /></span>
          <span><AutoText value={identity.role} /></span>
        </p>
      </div>
    </>
  );

  if (!interactive) {
    return (
      <details className="group -ml-2 lg:hidden">
        <summary
          aria-label={tx("Navigation")}
          className={cn(
            buttonClasses({ variant: 'ghost', size: 'icon' }),
            'list-none [&::-webkit-details-marker]:hidden',
          )}
        >
          <Menu aria-hidden="true" className="size-5! group-open:hidden" />
          <X aria-hidden="true" className="hidden size-5! group-open:block" />
        </summary>
        {/* Below the top bar, so its toggle stays visible to close the sheet again. */}
        <div className="nz-panel-strong fixed inset-x-0 top-[calc(4rem+2px)] bottom-0 z-40 grid content-start gap-6 overflow-y-auto border-t px-4 py-5">
          {content()}
        </div>
      </details>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="-ml-2 lg:hidden"
        aria-label={tx("Open navigation")}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Menu aria-hidden="true" className="size-5!" />
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        side="left"
        title={`${config.name} navigation`}
        hideTitle
        closeLabel="Close navigation"
      >
        <div className="grid gap-6">
          <Logo size="sm" />
          {content(close)}
        </div>
      </Dialog>
    </>
  );
}
