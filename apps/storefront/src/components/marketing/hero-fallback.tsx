import { cn } from '@nilzora/ui';
import { NilzoraMark } from '@/components/brand/nilzora-logo';

/**
 * What the hero shows when the store has no banner on show, or every banner image failed: a
 * navy-to-sky field with two slowly drifting soft shapes and the Nilzora mark. It is pure CSS
 * plus the bundled mark, carries no marketing text, and can never be a broken image.
 */
export function HeroFallback({ className }: { className?: string }) {
  return (
    <div
      data-hero-fallback=""
      className={cn(
        'relative isolate size-full overflow-hidden bg-linear-to-br from-brand-navy from-30% via-primary-action to-brand-sky',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="absolute -top-1/3 -left-1/6 aspect-square w-3/5 rounded-full bg-brand-sky/25 blur-3xl will-change-transform motion-safe:animate-drift"
      />
      <div
        aria-hidden="true"
        className="absolute -right-1/8 -bottom-1/2 aspect-square w-1/2 rounded-full bg-brand-violet/25 blur-3xl will-change-transform motion-safe:animate-drift motion-safe:[animation-delay:-11s]"
      />
      <div
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 aspect-square w-[min(36rem,70%)] -translate-1/2 rounded-full border border-white/10"
      />
      <div
        aria-hidden="true"
        className="absolute top-1/2 left-1/2 aspect-square w-[min(24rem,46%)] -translate-1/2 rounded-full border border-white/10"
      />
      <div className="relative flex size-full items-center justify-center lg:pt-(--nz-header-h)">
        <NilzoraMark
          tone="sky"
          priority
          className="size-14 drop-shadow-xl sm:size-16 md:size-20 lg:size-24"
        />
      </div>
    </div>
  );
}
