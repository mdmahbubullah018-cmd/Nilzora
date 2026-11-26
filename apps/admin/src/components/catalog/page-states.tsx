import type { Permission } from '@nilzora/contracts';
import { Alert } from '@nilzora/ui';
import type { Route } from 'next';
import type { ReactNode } from 'react';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { ForbiddenState, ReadState, type ReadFailure } from '@/components/admin-kit/states';
import { AutoText } from '@/components/i18n/translate';

/*
 * Whole-page outcomes of the catalog pages: the page keeps its title (so the outline
 * and the breadcrumb still make sense) and explains why there is nothing to show.
 */

export interface PageFailureProps {
  title: string;
  failure: ReadFailure;
  retryHref: Route;
  /** For `forbidden`: the permission the page needs. */
  permission?: Permission;
  /** For `invalid`: the page without its filters. */
  resetHref?: Route;
  back?: { href: Route; label: string };
}

export function PageFailure({
  title,
  failure,
  retryHref,
  permission,
  resetHref,
  back,
}: PageFailureProps) {
  return (
    <>
      <PageToolbar title={title} back={back} />
      <section className="nz-panel nz-panel-sheen rounded-2xl border">
        <ReadState
          failure={failure}
          retryHref={retryHref}
          permission={permission}
          resetHref={resetHref}
        />
      </section>
    </>
  );
}

/** The account may use the workspace but not this page (checked before any API call). */
export function PageForbidden({
  title,
  permission,
  back,
}: {
  title: string;
  permission: Permission;
  back?: { href: Route; label: string };
}) {
  return (
    <>
      <PageToolbar title={title} back={back} />
      <section className="nz-panel nz-panel-sheen rounded-2xl border">
        <ForbiddenState permission={permission} />
      </section>
    </>
  );
}

/** The confirmation after a change (from the `?notice=` the action redirected with). */
export function SuccessNotice({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Alert tone="success"><AutoText value={children} /></Alert>;
}
