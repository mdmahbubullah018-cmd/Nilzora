'use client';

import { slugify, slugSchema, type SlugKind } from '@nilzora/contracts';
import { Button, Field, Input, Spinner } from '@nilzora/ui';
import { CircleAlert, CircleCheck, Link2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { checkSlugAction, type SlugCheck } from '@/lib/slug-actions';
import { AutoText } from '@/components/i18n/translate';

/** How long typing must pause before the address is checked. */
export const SLUG_CHECK_DELAY_MS = 450;

export interface SlugFieldProps {
  id: string;
  name?: string;
  /** The form this field belongs to, when it sits outside the <form> element. */
  form?: string;
  label: ReactNode;
  kind: SlugKind;
  /** What the field starts with (typed after a refusal, or the saved address). */
  initial: string;
  /**
   * Text to make the address from (usually the name) while `auto` is on and the address
   * has not been typed by hand. Typing an address stops it; clearing the field resumes it.
   */
  source?: string;
  auto?: boolean;
  /** The item's own saved address, which is free for it (not checked). */
  savedSlug?: string;
  /** The item being edited, so the API treats its own address as free. */
  excludeId?: string;
  csrf: CsrfInput;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  maxLength?: number;
  /** Called when the address changes other than by typing (made from the name, a suggestion). */
  onChange?: (slug: string) => void;
}

type Status = SlugCheck | { state: 'checking' } | { state: 'current' };

/**
 * A catalog address with a live availability check. The check is a courtesy: it is
 * debounced, runs only for well-formed addresses, ignores answers that arrive after the
 * address changed again, and the save itself stays the authority.
 */
export function SlugField({
  id,
  name = 'slug',
  form,
  label,
  kind,
  initial,
  source = '',
  auto = false,
  savedSlug,
  excludeId,
  csrf,
  error,
  hint,
  required,
  maxLength = 120,
  onChange,
}: SlugFieldProps) {
  const [typed, setTyped] = useState(initial);
  // An address that arrives filled (saved, or typed before a refusal) counts as chosen.
  const [manual, setManual] = useState(initial !== '');
  const value = auto && !manual ? slugify(source) : typed;
  const [check, setCheck] = useState<{ slug: string; status: Status } | null>(null);

  const wellFormed = value !== '' && slugSchema.safeParse(value).success;
  const own = savedSlug !== undefined && value === savedSlug;

  useEffect(() => {
    if (!wellFormed || own) return undefined;
    const timer = window.setTimeout(() => {
      setCheck({ slug: value, status: { state: 'checking' } });
      const data = new FormData();
      data.set(csrf.name, csrf.token);
      data.set('kind', kind);
      data.set('slug', value);
      if (excludeId) data.set('excludeId', excludeId);
      checkSlugAction(data).then(
        (status) =>
          setCheck((current) => (current?.slug === value ? { slug: value, status } : current)),
        () =>
          setCheck((current) =>
            current?.slug === value ? { slug: value, status: { state: 'unknown' } } : current,
          ),
      );
    }, SLUG_CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [value, wellFormed, own, csrf.name, csrf.token, kind, excludeId]);

  useEffect(() => {
    // The made-up address changes without an input event; tell the form.
    if (auto && !manual) onChange?.(value);
  }, [auto, manual, value, onChange]);

  const status: Status | null = own
    ? { state: 'current' }
    : wellFormed && check?.slug === value
      ? check.status
      : null;

  const use = (suggestion: string) => {
    setTyped(suggestion);
    setManual(true);
    onChange?.(suggestion);
  };

  const statusId = `${id}-status`;
  return (
    <Field id={id} label={label} error={error} hint={hint} required={required}>
      {(control) => (
        <div className="grid gap-1.5">
          <Input
            {...control}
            aria-describedby={
              [control['aria-describedby'], status ? statusId : undefined]
                .filter(Boolean)
                .join(' ') || undefined
            }
            form={form}
            name={name}
            value={value}
            maxLength={maxLength}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              const next = event.currentTarget.value;
              setTyped(next);
              setManual(next !== '');
            }}
            className="font-mono max-sm:h-11"
          />
          <SlugStatus id={statusId} status={status} onUse={use} />
        </div>
      )}
    </Field>
  );
}

function SlugStatus({
  id,
  status,
  onUse,
}: {
  id: string;
  status: Status | null;
  onUse: (suggestion: string) => void;
}) {
  if (!status || status.state === 'unknown') {
    // Nothing to say: the save checks the address either way.
    return <span id={id} role="status" className="sr-only" />;
  }
  let content: ReactNode;
  switch (status.state) {
    case 'checking':
      content = (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Spinner label="" className="[&_svg]:size-3.5" />
          <AutoText>Checking the address…</AutoText>
        </span>
      );
      break;
    case 'current':
      content = (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Link2 aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
          <AutoText>The current address</AutoText>
        </span>
      );
      break;
    case 'available':
      content = (
        <span className="flex items-center gap-1.5 font-medium text-success-ink">
          <CircleCheck aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
          <AutoText>Available</AutoText>
        </span>
      );
      break;
    case 'invalid':
      content = (
        <span className="flex items-center gap-1.5 font-medium text-danger-ink">
          <CircleAlert aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
          <AutoText>Not a valid address</AutoText>
        </span>
      );
      break;
    case 'taken':
    case 'reserved':
      content = (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-warning-ink">
          <span className="flex items-center gap-1.5">
            <CircleAlert aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
            {status.state === 'reserved' ? 'Reserved by the store' : 'Taken'}
            {status.suggestion ? (
              <>
                {' — try '}
                <span className="font-mono">
                  <AutoText value={status.suggestion} />
                </span>
              </>
            ) : null}
          </span>
          {status.suggestion ? (
            <Button
              type="button"
              variant="link"
              className="text-xs max-sm:min-h-11"
              onClick={() => onUse(status.suggestion ?? '')}
            >
              Use {status.suggestion}
            </Button>
          ) : null}
        </span>
      );
      break;
  }
  return (
    <span id={id} role="status" className="text-xs">
      {content}
    </span>
  );
}
