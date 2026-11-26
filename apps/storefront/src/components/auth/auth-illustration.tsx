import { CartGlyph, cn } from '@nilzora/ui';
import {
  Footprints,
  HandCoins,
  Heart,
  Package,
  Shirt,
  Sparkles,
  Tag,
  Watch,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { NilzoraMark } from '@/components/brand/nilzora-logo';

/*
 * A decorative shopping scene drawn with CSS and lucide icons only: a phone showing a product
 * grid, with chips (cart, wishlist, delivery, offer, cash on delivery) floating around it.
 * No artwork is downloaded or invented, it carries no claims, and it is hidden from assistive
 * technology. Motion is a slow bob that stops under prefers-reduced-motion.
 *
 * It is drawn for a light surface: white cards with a hairline edge and a soft shadow on the
 * pale blue panel, brand-blue glyphs inside, and the sky reserved for the phone's own display.
 */

const TILES: readonly LucideIcon[] = [Shirt, Watch, Footprints, Sparkles];

/** Any outline icon the chips can hold: a Lucide icon or a shared glyph. */
type ChipIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

function Chip({
  icon: Icon,
  className,
  delay,
}: {
  icon: ChipIcon;
  className: string;
  /** Staggers the bob so the chips never move in step. */
  delay: string;
}) {
  return (
    <span
      className={cn(
        'absolute grid place-items-center rounded-2xl bg-white text-primary shadow-lg shadow-brand-navy/10 ring-1 ring-brand-navy/10 backdrop-blur-md will-change-transform motion-safe:animate-float',
        className,
      )}
      style={{ animationDelay: delay }}
    >
      <Icon className="size-1/2" strokeWidth={1.75} />
    </span>
  );
}

/** The full scene, for the illustration side of the sign-in pages. */
export function AuthIllustration({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('relative mx-auto aspect-square w-full max-w-md', className)}
    >
      {/* The phone */}
      <div className="absolute inset-y-[6%] left-1/2 w-[52%] -translate-x-1/2 rounded-[2.25rem] bg-white p-3 shadow-2xl shadow-brand-navy/15 ring-1 ring-brand-navy/10">
        <div className="flex h-full flex-col gap-3 rounded-[1.6rem] bg-[#F4FAFF] p-3 ring-1 ring-brand-sky/25">
          <div className="flex items-center gap-2">
            <NilzoraMark tone="navy" className="size-6" />
            <span className="h-2 flex-1 rounded-full bg-brand-sky/30" />
          </div>
          <span className="h-16 rounded-xl bg-linear-to-br from-brand-sky/45 to-brand-violet/30" />
          <div className="grid flex-1 grid-cols-2 gap-2">
            {TILES.map((Icon, index) => (
              <span
                key={index}
                className="grid place-items-center rounded-xl bg-white text-primary ring-1 ring-brand-sky/25"
              >
                <Icon className="size-6" strokeWidth={1.6} />
              </span>
            ))}
          </div>
          <span className="h-8 rounded-full bg-primary-action" />
        </div>
      </div>

      <Chip icon={CartGlyph} className="top-[14%] left-[4%] size-16" delay="0s" />
      <Chip icon={Heart} className="top-[8%] right-[8%] size-12" delay="-2.2s" />
      <Chip icon={Tag} className="top-[46%] right-[2%] size-14" delay="-4.1s" />
      <Chip icon={Package} className="bottom-[10%] left-[8%] size-14" delay="-1.3s" />
      <Chip icon={HandCoins} className="right-[12%] bottom-[4%] size-12" delay="-5.4s" />
    </div>
  );
}

/** A small strip of the same chips, for the top of the page on phones. */
export function AuthIllustrationStrip() {
  return (
    <div aria-hidden="true" className="flex items-center justify-center gap-3">
      {[CartGlyph, Heart, Package, Tag].map((Icon, index) => (
        <span
          key={index}
          className="grid size-10 place-items-center rounded-xl bg-white text-primary shadow-sm shadow-brand-navy/10 ring-1 ring-brand-sky/30 motion-safe:animate-float"
          style={{ animationDelay: `${-index * 1.6}s` }}
        >
          <Icon className="size-5" strokeWidth={1.75} />
        </span>
      ))}
    </div>
  );
}
