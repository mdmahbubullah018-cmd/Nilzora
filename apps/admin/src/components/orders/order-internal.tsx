'use client';

import type { OrderInternalResponse } from '@nilzora/contracts';
import { Button, Field, Textarea } from '@nilzora/ui';
import { Archive, ArchiveRestore, StickyNote } from 'lucide-react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { ConfirmForm } from '@/components/admin-kit/confirm-form';
import { SectionCard } from '@/components/admin-kit/section-card';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { addOrderNoteAction, setOrderArchivedAction } from '@/lib/order-internal-actions';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * Internal notes (staff only, never shown to the customer) and archiving a test order out of
 * the queues. The server decides both; this only gathers input and shows the answer.
 */

const TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Dhaka',
});

function AddButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" loading={pending}><AutoText>Add note</AutoText></Button>
  );
}

export function OrderInternalPanel({
  orderNumber,
  internal,
  canNote,
  canArchive,
  csrf,
}: {
  orderNumber: string;
  internal: OrderInternalResponse;
  canNote: boolean;
  canArchive: boolean;
  csrf: CsrfInput;
}) {
  const tx = useTx();
  const [noteState, addNote] = useActionState(addOrderNoteAction, IDLE_STATE);
  const [archiveState, setArchived] = useActionState(setOrderArchivedAction, IDLE_STATE);
  const archived = internal.archive !== null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <SectionCard
        title={tx("Internal notes")}
        icon={StickyNote}
        description={tx("Visible to staff only. The customer never sees these.")}
      >
        <div className="grid gap-4">
          {internal.notes.length === 0 ? (
            <p className="text-sm text-muted-foreground"><AutoText>No notes yet.</AutoText></p>
          ) : (
            <ol className="grid gap-3">
              {internal.notes.map((note) => (
                <li
                  key={note.id}
                  className="rounded-xl border border-hairline bg-surface-muted/50 p-3"
                >
                  <p className="text-sm whitespace-pre-wrap text-foreground"><AutoText value={note.body} /></p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {note.author ?? 'Staff'} · {TIME.format(new Date(note.createdAt))}
                  </p>
                </li>
              ))}
            </ol>
          )}
          {canNote ? (
            <form action={addNote} className="grid gap-2">
              <CsrfField csrf={csrf} />
              <input type="hidden" name="orderNumber" value={orderNumber} />
              <Field
                id={`note-${orderNumber}`}
                label={tx("Add a note")}
                error={noteState.fieldErrors?.body}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    name="body"
                    rows={3}
                    maxLength={1000}
                    defaultValue={
                      noteState.status === 'error' ? (noteState.values?.body ?? '') : ''
                    }
                    placeholder={tx("e.g. Customer asked for evening delivery")}
                  />
                )}
              </Field>
              <div>
                <AddButton />
              </div>
              <ActionFeedback state={noteState} />
            </form>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard
        title={archived ? 'Archived' : 'Archive'}
        icon={archived ? ArchiveRestore : Archive}
        description={
          archived
            ? 'This order is hidden from the order queues. Nothing was deleted.'
            : 'Hide a cancelled test order from the order queues. Nothing is deleted.'
        }
      >
        <div className="grid gap-3">
          {archived ? (
            <p className="text-sm text-foreground">
              Reason: {internal.archive?.reason ?? 'none given'}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Only a cancelled order whose cash was never collected, with no return or refund, can
              be archived. Its history and audit trail are kept.
            </p>
          )}
          {canArchive ? (
            archived ? (
              <form action={setArchived}>
                <CsrfField csrf={csrf} />
                <input type="hidden" name="orderNumber" value={orderNumber} />
                <input type="hidden" name="archive" value="false" />
                <Button type="submit" variant="outline" size="sm">
                  <ArchiveRestore aria-hidden="true" /><AutoText>Restore to the queues</AutoText></Button>
              </form>
            ) : (
              <ConfirmForm
                action={setArchived}
                csrf={csrf}
                align="start"
                trigger={
                  <>
                    <Archive aria-hidden="true" />
                    Archive order
                  </>
                }
                title={`Archive ${orderNumber}?`}
                description={tx("It leaves the order queues and reports' working views. You can restore it at any time.")}
                confirmLabel={tx("Archive")}
                tone="danger"
                hiddenFields={{ orderNumber, archive: 'true' }}
                error={archiveState.status === 'error' ? archiveState.message : undefined}
              >
                <Field
                  id={`archive-reason-${orderNumber}`}
                  label={tx("Reason")}
                  error={archiveState.fieldErrors?.reason}
                  required
                >
                  {(control) => (
                    <Textarea
                      {...control}
                      name="reason"
                      rows={2}
                      maxLength={300}
                      placeholder={tx("e.g. Test order")}
                    />
                  )}
                </Field>
              </ConfirmForm>
            )
          ) : null}
          {archiveState.status === 'success' ? <ActionFeedback state={archiveState} /> : null}
        </div>
      </SectionCard>
    </div>
  );
}
