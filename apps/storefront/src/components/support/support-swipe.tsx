'use client';

import { CornerUpLeft } from 'lucide-react';
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

/*
 * Swipe a message to the right to answer it (touch only)
 * ------------------------------------------------------
 * The same reply the message menu offers, as the gesture phones are used to. Only a touch or pen
 * swipe counts — a mouse has the hover buttons. The swipe starts after a deliberate move to the
 * right (16 px); a mostly vertical move first gives the touch back to the page so scrolling the
 * thread always wins (`touch-action: pan-y`). The bubble follows the finger with resistance past
 * the threshold, a reply arrow fades in behind it, and letting go past the threshold replies.
 * With reduced motion the bubble returns without easing.
 */

export const SWIPE_REPLY_THRESHOLD = 56;
const START_PX = 16;
const VERTICAL_CANCEL_PX = 12;
const MAX_TRAVEL = 76;

export function resistedTravel(dx: number): number {
  if (dx <= 0) return 0;
  if (dx <= SWIPE_REPLY_THRESHOLD) return dx;
  return Math.min(MAX_TRAVEL, SWIPE_REPLY_THRESHOLD + (dx - SWIPE_REPLY_THRESHOLD) * 0.35);
}

type Phase = 'idle' | 'pending' | 'swiping' | 'cancelled';

export function SwipeToReply({
  enabled,
  onReply,
  children,
}: {
  enabled: boolean;
  onReply: () => void;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const latest = useRef(0);
  const phase = useRef<Phase>('idle');
  const origin = useRef<{ x: number; y: number } | null>(null);

  const reset = () => {
    phase.current = 'idle';
    origin.current = null;
    latest.current = 0;
    setOffset(0);
  };

  const handlers = enabled
    ? {
        onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
          if (event.pointerType === 'mouse') return;
          phase.current = 'pending';
          origin.current = { x: event.clientX, y: event.clientY };
        },
        onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
          const start = origin.current;
          if (start === null || phase.current === 'cancelled' || phase.current === 'idle') return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (phase.current === 'pending') {
            if (Math.abs(dy) > VERTICAL_CANCEL_PX && Math.abs(dy) > Math.abs(dx)) {
              phase.current = 'cancelled';
              return;
            }
            if (dx < -VERTICAL_CANCEL_PX) {
              phase.current = 'cancelled';
              return;
            }
            if (dx <= START_PX) return;
            phase.current = 'swiping';
            event.currentTarget.setPointerCapture?.(event.pointerId);
          }
          const travel = resistedTravel(dx - START_PX);
          latest.current = travel;
          setOffset(travel);
        },
        onPointerUp: () => {
          const reply = phase.current === 'swiping' && latest.current >= SWIPE_REPLY_THRESHOLD;
          reset();
          if (reply) onReply();
        },
        onPointerCancel: reset,
      }
    : {};

  const progress = Math.min(1, offset / SWIPE_REPLY_THRESHOLD);
  return (
    <div className="relative touch-pan-y" {...handlers}>
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1 grid size-8 -translate-y-1/2 place-items-center rounded-full border border-border bg-surface-muted text-foreground"
        style={{
          opacity: progress,
          transform: `translateY(-50%) scale(${String(0.7 + 0.3 * progress)})`,
        }}
      >
        <CornerUpLeft className="size-4" />
      </span>
      <div
        data-testid="swipe-surface"
        className={
          offset === 0 ? 'motion-safe:transition-transform motion-safe:duration-200' : undefined
        }
        style={offset === 0 ? undefined : { transform: `translateX(${String(offset)}px)` }}
      >
        {children}
      </div>
    </div>
  );
}
