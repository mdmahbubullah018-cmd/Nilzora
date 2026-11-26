'use client';

import { Button, Dialog, Field, Input } from '@nilzora/ui';
import { useState } from 'react';

export function DialogPreview() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div className="flex flex-wrap gap-3">
      <Button variant="outline" onClick={() => setConfirmOpen(true)}>
        Open dialog
      </Button>
      <Button variant="outline" onClick={() => setSheetOpen(true)}>
        Open side sheet
      </Button>

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Cancel this order?"
        description="Preview only — this dialog does not change any data."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Keep order
            </Button>
            <Button variant="danger" onClick={() => setConfirmOpen(false)}>
              Cancel order
            </Button>
          </>
        }
      >
        <Field id="preview-reason" label="Reason" hint="Shared with the customer.">
          {(control) => <Input {...control} placeholder="e.g. Item out of stock" />}
        </Field>
      </Dialog>

      <Dialog
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        side="right"
        title="Side sheet"
        description="Used for filters and the admin mobile navigation."
      >
        <p className="text-sm">Sheets share the dialog&apos;s focus and keyboard behaviour.</p>
      </Dialog>
    </div>
  );
}
