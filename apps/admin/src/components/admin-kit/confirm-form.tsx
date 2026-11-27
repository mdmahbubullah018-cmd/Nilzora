'use client';

import {
  Button,
  buttonClasses,
  cn,
  Dialog,
  type ButtonSize,
  type ButtonVariant,
} from '@nilzora/ui';
import { useEffect, useId, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { useInteractive } from './use-interactive';
import { AutoText } from '@/components/i18n/translate';

export interface ConfirmFormProps {
  /**
   * A Server Action (or the dispatcher from useActionState). It must still check the
   * CSRF field and authorise the change: confirming is a usability step, not a check.
   */
  action: (formData: FormData) => void | Promise<void>;
  /** This browser's CSRF field, from the page's gate (`gate.csrf`). */
  csrf: CsrfInput;
  /** The first step's label, e.g. "Cancel order". */
  trigger: ReactNode;
  triggerVariant?: ButtonVariant;
  triggerSize?: ButtonSize;
  /** The question the second step asks, e.g. "Cancel order NZ100042?" */
  title: ReactNode;
  /** The consequence, e.g. "Its stock returns to inventory. This cannot be undone." */
  description?: ReactNode;
  /** The second step's label, e.g. "Yes, cancel the order". */
  confirmLabel: string;
  /** `danger` for destructive or irreversible changes. */
  tone?: 'danger' | 'primary';
  /** Values the action needs, e.g. `{ orderNumber, status: 'cancelled' }`. */
  hiddenFields?: Readonly<Record<string, string>>;
  /** Extra fields for the second step, e.g. a required reason. */
  children?: ReactNode;
  /** A message from the last attempt (e.g. useActionState's error), shown in the panel. */
  error?: ReactNode;
  /** Without JavaScript: which edge of the trigger the inline panel lines up with. */
  align?: 'start' | 'end';
  /** Classes for the trigger's <details> wrapper. */
  className?: string;
  /**
   * Classes for the modal itself, e.g. `sm:max-w-md` when the question is short and the
   * dialog should stay a compact panel instead of the shared default width.
   */
  dialogClassName?: string;
}

/** The one confirmation open on the page: opening another closes it first. */
let openConfirmation: { close: () => void } | null = null;

/** Calls `onSettled` when a submission of the surrounding form finishes. */
/**
 * Reports when a submission of the surrounding form finishes, and whether it was
 * refused (`refused` is read from the same render as the end of the submission).
 */
function SubmitWatcher({
  refused,
  onSettled,
}: {
  refused: boolean;
  onSettled: (refused: boolean) => void;
}) {
  const { pending } = useFormStatus();
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) onSettled(refused);
    wasPending.current = pending;
  }, [pending, refused, onSettled]);
  return null;
}

/** The form's actions: the quiet way out, then the one that commits. */
function PanelActions({
  label,
  tone,
  onKeep,
}: {
  label: string;
  tone: 'danger' | 'primary';
  onKeep?: (() => void) | undefined;
}) {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {/*
        A refusal or a slow action keeps the panel open; saying so on the left of the row
        answers "did it take?" without moving either button or changing the panel's height.
      */}
      <p role="status" className="mr-auto text-xs text-muted-foreground">
        {pending ? 'Saving…' : ''}
      </p>
      {onKeep ? (
        <Button variant="ghost" size="sm" onClick={onKeep} disabled={pending}>
          <AutoText>Keep it</AutoText>
        </Button>
      ) : null}
      <Button type="submit" size="sm" variant={tone} loading={pending}>
        {label}
      </Button>
    </div>
  );
}

interface PanelBodyProps extends Pick<
  ConfirmFormProps,
  'action' | 'csrf' | 'hiddenFields' | 'children' | 'error' | 'confirmLabel' | 'tone'
> {
  onKeep?: () => void;
  onSettled?: (refused: boolean) => void;
}

function PanelForm({
  action,
  csrf,
  hiddenFields = {},
  children,
  error,
  confirmLabel,
  tone = 'danger',
  onKeep,
  onSettled,
}: PanelBodyProps) {
  return (
    <form action={action} className="grid gap-3">
      <CsrfField csrf={csrf} />
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger-ink">
          {error}
        </p>
      ) : null}
      <PanelActions label={confirmLabel} tone={tone} onKeep={onKeep} />
      {onSettled ? <SubmitWatcher refused={Boolean(error)} onSettled={onSettled} /> : null}
    </form>
  );
}

/**
 * A two-step confirmation for consequential changes.
 *
 * With JavaScript the second step is a modal dialog in the browser's top layer, so it
 * is never clipped by a scrolling table and always fits the viewport. Escape, a click
 * outside, focus leaving it or "Keep it" close it and focus returns to the trigger;
 * only one confirmation is open at a time. It stays open while the action runs and
 * after a refusal (showing `error`), and closes once the action succeeds.
 *
 * Without JavaScript (and until the page is interactive) the trigger is a native
 * <details> that reveals the same form inline; it posts an ordinary form carrying the
 * CSRF field. `className` applies to the trigger's <details> wrapper; `dialogClassName`
 * sizes the modal itself, for a question whose answer needs less room than the default.
 */
export function ConfirmForm({
  action,
  csrf,
  trigger,
  triggerVariant = 'outline',
  triggerSize = 'sm',
  title,
  description,
  confirmLabel,
  tone = 'danger',
  hiddenFields = {},
  children,
  error,
  align = 'end',
  className,
  dialogClassName,
}: ConfirmFormProps) {
  const interactive = useInteractive();
  // A refusal rendered on arrival (e.g. after a post without JavaScript) starts open.
  const [open, setOpen] = useState(() => Boolean(error));
  const triggerRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(open);
  const titleId = useId();
  const descriptionId = useId();

  // Register as the page's open confirmation, and give focus back to the trigger once
  // the dialog has closed (the trigger is inert while the modal is open).
  useEffect(() => {
    if (open) {
      const self = { close: () => setOpen(false) };
      if (openConfirmation && openConfirmation !== self) openConfirmation.close();
      openConfirmation = self;
      return () => {
        if (openConfirmation === self) openConfirmation = null;
      };
    }
    if (wasOpen.current) triggerRef.current?.focus();
    return undefined;
  }, [open]);

  useEffect(() => {
    wasOpen.current = open;
  }, [open]);

  const panelProps = { action, csrf, hiddenFields, error, confirmLabel, tone, children };

  if (!interactive) {
    return (
      <details open={error ? true : undefined} className={cn('relative', className)}>
        <summary
          className={cn(
            buttonClasses({ variant: triggerVariant, size: triggerSize }),
            'list-none [&::-webkit-details-marker]:hidden',
          )}
        >
          {trigger}
        </summary>
        <div
          role="group"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          className={cn(
            'absolute top-full z-40 mt-2 grid w-80 max-w-[calc(100vw-2rem)] gap-3 rounded-lg border border-border bg-surface p-4 text-left shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          <div className="grid gap-1">
            <p id={titleId} className="text-sm font-semibold text-foreground">
              {title}
            </p>
            {description ? (
              <p id={descriptionId} className="text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          <PanelForm {...panelProps} />
        </div>
      </details>
    );
  }

  const close = () => setOpen(false);

  // Focus moving anywhere outside the dialog (not merely to nothing) closes it.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    const dialog = event.currentTarget.closest('dialog');
    if (next instanceof Node && dialog && !dialog.contains(next)) close();
  };

  return (
    <>
      {/*
        The same <details>/<summary> trigger as without JavaScript (so the markup does
        not change on hydration), but it opens the dialog instead of the inline panel.
      */}
      <details className={cn('relative', className)}>
        <summary
          ref={triggerRef}
          // It opens a dialog rather than disclosing content, so it is announced as a button.
          role="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
          className={cn(
            buttonClasses({ variant: triggerVariant, size: triggerSize }),
            'list-none [&::-webkit-details-marker]:hidden',
          )}
        >
          {trigger}
        </summary>
      </details>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={title}
        description={description}
        closeLabel="Keep it"
        className={dialogClassName}
      >
        <div onBlur={onBlur}>
          <PanelForm
            {...panelProps}
            onKeep={close}
            onSettled={(refused) => {
              if (!refused) close();
            }}
          />
        </div>
      </Dialog>
    </>
  );
}
