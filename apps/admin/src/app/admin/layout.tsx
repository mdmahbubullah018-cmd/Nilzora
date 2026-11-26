import { AccessGate } from '@/components/access/access-gate';
import { WorkspaceFrame } from '@/components/shell/workspace-shell';
import { workspaceGate } from '@/lib/access';

/**
 * The admin workspace frame. The layout verifies the session on a full page load and
 * renders the rail, header and menus once; they stay mounted while the pages inside change,
 * so navigating only swaps the page content (with its own loading skeleton). Layouts do not
 * re-render on client navigation, so every page still repeats the access check itself, and
 * the server checks every permission again on every API call.
 */
export default async function AdminLayout({ children }: LayoutProps<'/admin'>) {
  const gate = await workspaceGate('admin', '/admin');
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref="/admin" />;
  }
  return (
    <WorkspaceFrame workspace="admin" user={gate.user} csrf={gate.csrf}>
      {children}
    </WorkspaceFrame>
  );
}
