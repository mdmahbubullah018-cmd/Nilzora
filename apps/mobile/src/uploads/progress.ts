/*
 * Upload progress arithmetic. The same two rules the web apps use (@nilzora/ui), kept here
 * because the app cannot import a DOM package: a percentage counts only bytes the native layer
 * reported as sent, and it reaches 100 only when every byte is.
 */

/** Whole percent of `total` that `sent` covers: 0 until bytes move, 100 only when all did. */
export function percentOf(sent: number, total: number): number {
  if (!Number.isFinite(sent) || !Number.isFinite(total) || total <= 0 || sent <= 0) return 0;
  return Math.min(100, Math.floor((sent / total) * 100));
}

/** "4.6 MB", "812 KB" or "310 B": the size of a transfer for people. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${String(Math.round(bytes))} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${String(mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10)} MB`;
}

export interface TransferProgress {
  sent: number;
  total: number;
  percent: number;
}
