'use client';

import { WorkspaceErrorScreen } from '@/components/shell/workspace-status';

/**
 * Unexpected failures in the moderator workspace. Shows only the server's error reference,
 * never the message or stack trace.
 */
export default function ModeratorError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <WorkspaceErrorScreen workspace="moderator" onRetry={retry} reference={error.digest} />;
}
