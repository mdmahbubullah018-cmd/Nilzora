import { cn } from '../lib/cn';
import { Skeleton } from '../components/loading';

/*
 * Loading placeholders for a conversation, shaped like what is about to arrive so nothing jumps
 * when the real messages replace them: text bubbles, a picture, a file chip and a voice message,
 * alternating sides like a real thread. They are decorative (the Skeleton blocks are hidden from
 * assistive tech); the wrapper carries the one spoken "Loading messages" status.
 */

export type ChatSkeletonKind = 'text' | 'image' | 'file' | 'voice';

/** One placeholder bubble or attachment, sized like the real one. */
export function ChatAttachmentSkeleton({
  kind,
  className,
}: {
  kind: ChatSkeletonKind;
  className?: string;
}) {
  switch (kind) {
    case 'image':
      // The real picture is at most max-h-64 / max-w-72; a 4:3 block reserves a similar frame.
      return <Skeleton className={cn('aspect-[4/3] w-full max-w-72 rounded-xl', className)} />;
    case 'file':
      return (
        <div
          className={cn(
            'flex w-full max-w-64 items-center gap-3 rounded-xl border border-hairline p-3',
            className,
          )}
        >
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <div className="grid min-w-0 flex-1 gap-1.5">
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-2.5 w-2/5" />
          </div>
        </div>
      );
    case 'voice':
      return (
        <div
          className={cn(
            'flex w-full max-w-64 items-center gap-3 rounded-2xl border border-hairline px-3 py-2.5',
            className,
          )}
        >
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex h-6 flex-1 items-center gap-0.5">
            {[40, 70, 55, 90, 60, 80, 45, 65, 35, 75, 50, 85].map((height, index) => (
              <Skeleton key={index} className="w-1 rounded-full" style={{ height: `${height}%` }} />
            ))}
          </div>
          <Skeleton className="h-2.5 w-8" />
        </div>
      );
    default:
      return (
        <div className={cn('grid w-full max-w-sm gap-2 rounded-2xl p-3', className)}>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      );
  }
}

const ROWS: readonly { from: 'them' | 'me'; kind: ChatSkeletonKind }[] = [
  { from: 'them', kind: 'text' },
  { from: 'me', kind: 'image' },
  { from: 'them', kind: 'voice' },
  { from: 'me', kind: 'file' },
  { from: 'them', kind: 'text' },
];

/** The whole thread while its messages are being fetched. */
export function ChatMessagesSkeleton({ className }: { className?: string }) {
  return (
    <div role="status" aria-label="Loading messages" className={cn('grid gap-4', className)}>
      {ROWS.map((row, index) => (
        <div
          key={index}
          className={cn('flex', row.from === 'me' ? 'justify-end' : 'justify-start')}
        >
          <ChatAttachmentSkeleton
            kind={row.kind}
            className={row.kind === 'text' ? 'bg-surface-muted/60' : undefined}
          />
        </div>
      ))}
    </div>
  );
}
