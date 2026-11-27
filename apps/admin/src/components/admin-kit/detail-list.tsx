import { cn } from '@nilzora/ui';
import type { ReactNode } from 'react';
import { AutoText } from '@/components/i18n/translate';

export interface DetailItem {
  /** Unique within the list; defaults to the label when that is a string. */
  key?: string;
  label: ReactNode;
  /** Shown as "—" (announced as "Not set") when null, undefined or an empty string. */
  value: ReactNode;
  /** A short note under the value. */
  hint?: ReactNode;
  /** Spans the whole row (long text such as an address or a note). */
  wide?: boolean;
}

const columnClasses = {
  1: '',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
} as const;

export interface DetailListProps {
  items: readonly DetailItem[];
  columns?: keyof typeof columnClasses;
  className?: string;
}

function isEmpty(value: ReactNode): boolean {
  return value === null || value === undefined || value === '';
}

/** Label/value pairs of a record (a description list), e.g. an order's delivery details. */
export function DetailList({ items, columns = 2, className }: DetailListProps) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4', columnClasses[columns], className)}>
      {items.map((item, index) => (
        <div
          key={item.key ?? (typeof item.label === 'string' ? item.label : String(index))}
          className={cn('grid min-w-0 content-start gap-1', item.wide && 'sm:col-span-full')}
        >
          <dt className="text-xs font-medium text-muted-foreground">
            <AutoText value={item.label} />
          </dt>
          <dd className="text-sm break-words text-foreground">
            {isEmpty(item.value) ? (
              <>
                <span aria-hidden="true" className="text-muted-foreground">
                  —
                </span>
                <span className="sr-only">
                  <AutoText>Not set</AutoText>
                </span>
              </>
            ) : (
              item.value
            )}
          </dd>
          {item.hint ? (
            <dd className="text-xs text-muted-foreground">
              <AutoText value={item.hint} />
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
