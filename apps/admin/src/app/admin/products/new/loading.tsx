import { WorkspaceLoading } from '@/components/shell/workspace-status';

/** The page's own placeholder shape, drawn until its data streams in. */
export default function Loading() {
  return (
    <WorkspaceLoading workspace="admin" shape="editor" label="Loading the new product form" />
  );
}