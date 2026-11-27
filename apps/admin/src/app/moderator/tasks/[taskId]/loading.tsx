import { WorkspaceLoading } from '@/components/shell/workspace-status';

/** The page's own placeholder shape, drawn until its data streams in. */
export default function Loading() {
  return <WorkspaceLoading workspace="moderator" shape="detail" label="Loading the review" />;
}
