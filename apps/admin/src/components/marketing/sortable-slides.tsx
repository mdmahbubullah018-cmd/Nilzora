'use client';

import { GripVertical } from 'lucide-react';
import { useState, useTransition, type DragEvent, type ReactNode } from 'react';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { reorderOnboardingSlidesAction } from '@/lib/onboarding-actions';

/*
 * The slide list with drag-and-drop ordering.
 *
 * Each slide is a row (rendered by the server, so its own controls keep working); this wrapper
 * adds a drag handle to the row and reorders by dragging it onto another row. The new order is
 * sent to the server as the complete list of slide ids; the database refuses a list that is not
 * exactly the campaign's slides, so a stale page can never scramble the order. The move up / down
 * buttons stay as the keyboard and touch way to do the same.
 */
export function SortableSlides({
  campaignId,
  csrf,
  ids,
  children,
}: {
  campaignId: string;
  csrf: CsrfInput;
  /** The slide ids in the order they are rendered. */
  ids: readonly string[];
  /** One <li> per slide, in the same order as `ids`. */
  children: readonly ReactNode[];
}) {
  const [order, setOrder] = useState<readonly string[]>(ids);
  const [serverIds, setServerIds] = useState<readonly string[]>(ids);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);

  // A fresh list from the server (after a save, a move or a delete) replaces the local order.
  if (serverIds.join(',') !== ids.join(',')) {
    setServerIds(ids);
    setOrder(ids);
  }

  const byId = new Map(ids.map((id, index) => [id, children[index]] as const));

  const drop = (target: string) => {
    if (dragging === null || dragging === target) return;
    const next = order.filter((id) => id !== dragging);
    next.splice(next.indexOf(target), 0, dragging);
    setOrder(next);
    setProblem(null);
    const form = new FormData();
    form.set(csrf.name, csrf.token);
    form.set('campaignId', campaignId);
    form.set('order', next.join(','));
    startTransition(async () => {
      const result = await reorderOnboardingSlidesAction(form);
      if (!result.ok) {
        setOrder(ids);
        setProblem(result.message);
      }
    });
  };

  const onDragStart = (event: DragEvent<HTMLElement>, id: string) => {
    setDragging(id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };

  return (
    <div>
      {problem === null ? null : (
        <p role="alert" className="mb-2 text-sm text-danger-ink">
          {problem}
        </p>
      )}
      <ul role="list" aria-busy={pending} className={pending ? 'opacity-70' : undefined}>
        {order.map((id) => (
          <li
            key={id}
            draggable
            onDragStart={(event) => onDragStart(event, id)}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(id);
            }}
            onDrop={(event) => {
              event.preventDefault();
              drop(id);
              setOver(null);
            }}
            className={[
              'flex items-start gap-1 rounded-lg',
              dragging === id ? 'opacity-40' : '',
              over === id && dragging !== id ? 'ring-2 ring-primary/40' : '',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              title="Drag to reorder"
              className="mt-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing"
            >
              <GripVertical className="size-4" />
            </span>
            <div className="min-w-0 flex-1">{byId.get(id)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
