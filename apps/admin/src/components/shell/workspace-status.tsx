import { buttonClasses, Card } from '@nilzora/ui';
import { PageSkeleton, type PageSkeletonVariant } from '@/components/admin-kit/skeletons';
import { CircleAlert, RotateCcw } from 'lucide-react';
import Link from 'next/link';
import { workspaces, type Workspace } from '@/lib/navigation';
import { AutoText } from '@/components/i18n/translate';

/*
 * Screens shown while a workspace page loads or after it failed. Both render inside the
 * persistent workspace frame (the layout keeps the rail and header mounted), so they fill
 * only the page area and carry no account data of their own.
 */

export interface WorkspaceErrorScreenProps {
  /** Where "Back to …" leads; omit outside a workspace (the app root decides). */
  workspace?: Workspace;
  /** Renders the page again, fetching its data afresh. */
  onRetry: () => void;
  /**
   * The server's error reference (Next.js `error.digest`), which matches its logs.
   * Never the message or stack: those can carry internal details.
   */
  reference?: string | undefined;
}

/** A page failed unexpectedly: an apology, a retry and a way home, without details. */
export function WorkspaceErrorScreen({ workspace, onRetry, reference }: WorkspaceErrorScreenProps) {
  const home = workspace ? workspaces[workspace] : undefined;
  return (
    <div role="alert" className="grid min-h-[60vh] place-items-center py-10">
      <Card className="w-full max-w-md nz-panel-strong nz-panel-sheen grid justify-items-center gap-4 rounded-2xl p-6 text-center sm:p-8">
        <span className="nz-float grid size-14 place-items-center rounded-full bg-danger-soft text-danger-ink shadow-glass ring-8 ring-danger-soft">
          <CircleAlert aria-hidden="true" className="size-6" strokeWidth={1.6} />
        </span>
        <div className="grid gap-1.5">
          <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">
            <AutoText>This page could not be shown</AutoText>
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Something went wrong on our side. Nothing you entered was changed by this error. Try
            again, and if it keeps happening, let an admin know.
          </p>
          {reference ? (
            <p className="text-xs text-muted-foreground">
              Reference: <code className="font-mono">{reference}</code>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" onClick={onRetry} className={buttonClasses()}>
            <RotateCcw aria-hidden="true" />
            <AutoText>Try again</AutoText>
          </button>
          {home ? (
            <Link href={home.home} className={buttonClasses({ variant: 'outline' })}>
              Back to {home.name.toLowerCase()} home
            </Link>
          ) : (
            <Link href="/" className={buttonClasses({ variant: 'outline' })}>
              <AutoText>Go to your workspace</AutoText>
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}

/**
 * The workspace's frame with placeholder blocks, shown while a page's data loads. The
 * real page (with navigation for the verified account) replaces it.
 */
/** The page shape a loading screen previews, so content does not jump when it arrives. */
export type LoadingShape = PageSkeletonVariant;

/**
 * A route's loading state. It renders inside the workspace frame (the layout keeps the rail
 * and header mounted), so only the page area shows a skeleton shaped like the page that is
 * coming: the sidebar never flashes or reloads.
 */
export function WorkspaceLoading({
  workspace,
  shape = 'dashboard',
  label,
}: {
  workspace: Workspace;
  shape?: LoadingShape;
  /** Names the loading work; defaults to a plain "Loading…" for the screen reader. */
  label?: string;
}) {
  return (
    <div data-workspace={workspace} data-loader="page" className="grid gap-6">
      {/* The chosen skeleton carries the single status for assistive technology. */}
      <PageSkeleton variant={shape} label={label ?? 'Loading…'} />
    </div>
  );
}
