'use client';

import { PRODUCT_TAG_LIMIT, productTagSchema } from '@nilzora/contracts';
import { Input } from '@nilzora/ui';
import { X } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { useInteractive } from '@/components/admin-kit/use-interactive';
import { useTx } from '@/lib/i18n/provider';

export interface TagInputProps {
  /** The text field's id (the label points at it). */
  id: string;
  /** The field the tags travel in, comma separated. */
  name?: string;
  form?: string;
  /** Comma-separated tags to start with. */
  initial: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  /** Called with the comma-separated tags after every change. */
  onChange?: (text: string) => void;
}

function split(text: string): string[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * Merchandising tags as removable chips. Each tag is checked with the contract's rule
 * as it is added (lower-case letters, numbers, spaces and hyphens; at most 15 tags), and
 * the tags travel as one comma-separated field. Without JavaScript it is a plain text
 * field taking the same comma-separated list.
 */
export function TagInput({
  id,
  name = 'tags',
  form,
  initial,
  onChange,
  ...aria
}: TagInputProps) {
  const tx = useTx();
  const interactive = useInteractive();
  const [tags, setTags] = useState<string[]>(() => [...new Set(split(initial))]);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  if (!interactive) {
    return (
      <Input
        id={id}
        name={name}
        form={form}
        defaultValue={initial}
        autoComplete="off"
        spellCheck={false}
        {...aria}
      />
    );
  }

  const update = (next: string[]) => {
    setTags(next);
    onChange?.(next.join(', '));
  };

  const add = (text: string) => {
    const parts = split(text);
    if (parts.length === 0) return;
    const next = [...tags];
    let refusal: string | null = null;
    for (const part of parts) {
      const parsed = productTagSchema.safeParse(part);
      if (!parsed.success) {
        refusal = `“${part}”: ${parsed.error.issues[0]?.message ?? 'not a valid tag'}.`;
        continue;
      }
      if (next.includes(parsed.data)) continue;
      if (next.length >= PRODUCT_TAG_LIMIT) {
        refusal = `Use at most ${String(PRODUCT_TAG_LIMIT)} tags.`;
        break;
      }
      next.push(parsed.data);
    }
    setMessage(refusal);
    setDraft('');
    if (next.length !== tags.length) update(next);
  };

  const remove = (tag: string) => {
    update(tags.filter((candidate) => candidate !== tag));
    setMessage(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add(draft);
    } else if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      const last = tags[tags.length - 1];
      if (last !== undefined) remove(last);
    }
  };

  const messageId = `${id}-message`;
  const describedBy =
    [aria['aria-describedby'], message ? messageId : undefined].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div className="grid gap-1.5">
      <input type="hidden" name={name} form={form} value={tags.join(', ')} />
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-input-border bg-surface p-1.5 focus-within:border-primary focus-within:outline-2 focus-within:outline-ring">
        <ul aria-label={tx("Tags")} className="contents">
          {tags.map((tag) => (
            <li
              key={tag}
              className="inline-flex h-8 items-center gap-1 rounded-full bg-info-soft pr-1 pl-3 text-xs font-semibold text-info-ink ring-1 ring-info-line ring-inset max-sm:h-11"
            >
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={`Remove tag ${tag}`}
                className="grid size-6 place-items-center rounded-full transition-colors hover:bg-info-line focus-visible:outline-2 focus-visible:outline-ring max-sm:size-9"
              >
                <X aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
        <input
          id={id}
          value={draft}
          onChange={(event) => {
            const next = event.currentTarget.value;
            // A comma typed or pasted ends a tag.
            if (next.includes(',')) add(next);
            else setDraft(next);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          placeholder={tags.length === 0 ? 'e.g. summer sale, eid-2026' : 'Add a tag'}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={describedBy}
          aria-invalid={aria['aria-invalid']}
          className="h-8 min-w-32 flex-1 bg-transparent px-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground max-sm:h-11"
        />
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        {message ? (
          <p id={messageId} role="alert" className="font-medium text-danger-ink">
            {message}
          </p>
        ) : (
          <span />
        )}
        <span className="tabular-nums">
          {tags.length} of {PRODUCT_TAG_LIMIT}
        </span>
      </div>
    </div>
  );
}
