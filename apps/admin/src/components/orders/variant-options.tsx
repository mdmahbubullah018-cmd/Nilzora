import type { OrderItemOption } from '@nilzora/contracts';
import { cn } from '@nilzora/ui';
import { AutoText } from '@/components/i18n/translate';

/*
 * What the customer chose on one order line, as the packing staff need it: every option as its own
 * labelled chip (Colour: Black, Size: L), never a clipped line of text. It reads the snapshot
 * written when the order was placed; an older order that only has the text label shows that label,
 * and a simple product says so.
 */
export function VariantOptions({
  options,
  label,
  size = 'sm',
  className,
}: {
  options: readonly OrderItemOption[] | undefined;
  label: string | null;
  size?: 'sm' | 'lg';
  className?: string;
}) {
  if (options !== undefined && options.length > 0) {
    return (
      <ul
        role="list"
        aria-label="Chosen options"
        className={cn('flex flex-wrap gap-1.5', className)}
      >
        {options.map((option) => (
          <li
            key={`${option.name}:${option.value}`}
            className={cn(
              'inline-flex items-baseline gap-1.5 rounded-lg border border-info-line bg-info-soft px-2 whitespace-normal text-info-ink',
              size === 'lg' ? 'py-1 text-sm' : 'py-0.5 text-xs',
            )}
          >
            <span className="text-info-ink/70">{option.name}</span>
            <strong className="font-semibold">{option.value}</strong>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <span className={cn('text-xs text-muted-foreground', className)}>
      {label ? <AutoText value={label} /> : <AutoText>No options</AutoText>}
    </span>
  );
}
