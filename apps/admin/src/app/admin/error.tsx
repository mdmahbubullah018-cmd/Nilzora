'use client';

import { WorkspaceErrorScreen } from '@/components/shell/workspace-status';

/**
 * Unexpected failures in the admin workspace. Shows only the server's error reference,
 * never the message or stack trace.
 */
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <WorkspaceErrorScreen workspace="admin" onRetry={retry} reference={error.digest} />;
}
