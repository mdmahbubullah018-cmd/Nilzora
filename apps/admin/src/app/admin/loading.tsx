import { WorkspaceLoading } from '@/components/shell/workspace-status';

/** The workspace frame's first paint, before a page's own skeleton takes over. */
export default function AdminLoading() {
  return <WorkspaceLoading workspace="admin" shape="neutral" label="Loading the workspace" />;
}