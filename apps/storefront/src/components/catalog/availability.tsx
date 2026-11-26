import type { Availability } from '@nilzora/contracts';
import { Badge, type BadgeTone } from '@nilzora/ui';

/** Shoppers see a stock band from the API, never an exact stock level. */
const AVAILABILITY = {
  in_stock: { tone: 'success', label: 'In stock' },
  low_stock: { tone: 'warning', label: 'Only a few left' },
  out_of_stock: { tone: 'neutral', label: 'Out of stock' },
} as const satisfies Record<Availability, { tone: BadgeTone; label: string }>;

export function availabilityLabel(availability: Availability): string {
  return AVAILABILITY[availability].label;
}

export function AvailabilityBadge({
  availability,
  className,
}: {
  availability: Availability;
  className?: string;
}) {
  const { tone, label } = AVAILABILITY[availability];
  return (
    <Badge tone={tone} dot className={className}>
      {label}
    </Badge>
  );
}
