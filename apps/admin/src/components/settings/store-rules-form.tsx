'use client';

import { Field, Input } from '@nilzora/ui';
import { Save } from 'lucide-react';
import { useActionState, useState } from 'react';
import { ActionFeedback, IDLE_STATE } from '@/components/admin-kit/action-feedback';
import { SubmitButton } from '@/components/admin-kit/submit-button';
import { CsrfField, type CsrfInput } from '@/components/auth/csrf-field';
import { useUnsavedChanges } from '@/components/catalog/use-unsaved-changes';
import { saveStoreRulesAction } from '@/lib/settings-actions';
import {
  checkStoreRules,
  STORE_RULE_FIELDS,
  STORE_RULE_LIMITS,
  type StoreRuleErrors,
  type StoreRuleField,
  type StoreRuleTexts,
} from './store-rules';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

const TOUCH = 'tabular-nums max-sm:h-11';

interface RuleFieldProps {
  field: StoreRuleField;
  label: string;
  unit: string;
  hint: string;
  required?: boolean;
  decimal?: boolean;
  value: string;
  error: string | undefined;
  onChange: (field: StoreRuleField, value: string) => void;
  onBlur: (field: StoreRuleField) => void;
}

function RuleField({
  field,
  label,
  unit,
  hint,
  required,
  decimal,
  value,
  error,
  onChange,
  onBlur,
}: RuleFieldProps) {
  return (
    <Field id={`rule-${field}`} label={label} required={required} error={error} hint={hint}>
      {(control) => (
        <div className="flex items-center gap-2">
          <Input
            {...control}
            name={field}
            type="text"
            inputMode={decimal ? 'decimal' : 'numeric'}
            autoComplete="off"
            value={value}
            onChange={(event) => onChange(field, event.currentTarget.value)}
            onBlur={() => onBlur(field)}
            className={`max-w-40 ${TOUCH}`}
          />
          <span className="text-sm text-muted-foreground">
            <AutoText value={unit} />
          </span>
        </div>
      )}
    </Field>
  );
}

/**
 * The store rules: the return window, how long a cart may sit before it stops counting as
 * an open checkout, and the thresholds behind the customer segments. Checked here with the
 * contract's request schema as staff type, again by the Server Action, and a third time by
 * the API. A threshold left empty keeps its current value.
 */
export function StoreRulesForm({ initial, csrf }: { initial: StoreRuleTexts; csrf: CsrfInput }) {
  const tx = useTx();
  const [state, action] = useActionState(saveStoreRulesAction, IDLE_STATE);
  const [texts, setTexts] = useState<StoreRuleTexts>(initial);
  const [errors, setErrors] = useState<StoreRuleErrors>({});
  const [visited, setVisited] = useState<ReadonlySet<StoreRuleField>>(new Set());

  const dirty = STORE_RULE_FIELDS.some((field) => texts[field] !== initial[field]);
  useUnsavedChanges(dirty);

  const recheck = (next: StoreRuleTexts) => {
    const checked = checkStoreRules(next);
    setErrors(checked.ok ? {} : checked.errors);
  };
  const change = (field: StoreRuleField, value: string) => {
    const next = { ...texts, [field]: value };
    setTexts(next);
    recheck(next);
  };
  const visit = (field: StoreRuleField) => setVisited((previous) => new Set([...previous, field]));
  const errorOf = (field: StoreRuleField) =>
    (visited.has(field) ? errors[field] : undefined) ??
    (state.status === 'error' ? state.fieldErrors?.[field] : undefined);

  const shared = { onChange: change, onBlur: visit };
  const limits = STORE_RULE_LIMITS;

  return (
    <form
      action={action}
      noValidate
      onSubmit={(event) => {
        const checked = checkStoreRules(texts);
        if (checked.ok) return;
        event.preventDefault();
        setErrors(checked.errors);
        setVisited(new Set(STORE_RULE_FIELDS));
      }}
      className="grid gap-6"
    >
      <CsrfField csrf={csrf} />

      <fieldset className="grid gap-4">
        <legend className="mb-1 text-sm font-semibold text-foreground">
          <AutoText>Returns and checkouts</AutoText>
        </legend>
        <div className="grid items-start gap-5 sm:grid-cols-2">
          <RuleField
            {...shared}
            field="returnWindowDays"
            label={tx('Return window')}
            unit="days"
            required
            hint={`How long after delivery a customer may ask to return items. ${String(limits.returnWindowDays.min)} to ${String(limits.returnWindowDays.max)}.`}
            value={texts.returnWindowDays}
            error={errorOf('returnWindowDays')}
          />
          <RuleField
            {...shared}
            field="cartInactivityMinutes"
            label={tx('Cart inactivity')}
            unit="minutes"
            required
            hint={`After this long without activity a cart no longer counts as an open checkout. ${String(limits.cartInactivityMinutes.min)} to ${limits.cartInactivityMinutes.max.toLocaleString('en-US')}.`}
            value={texts.cartInactivityMinutes}
            error={errorOf('cartInactivityMinutes')}
          />
        </div>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-1 text-sm font-semibold text-foreground">
          <AutoText>Customer insight</AutoText>
        </legend>
        <div className="grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <RuleField
            {...shared}
            field="repeatOrderThreshold"
            label={tx('Repeat customer from')}
            unit="orders"
            hint={`Orders that make a customer a repeat customer. ${String(limits.repeatOrderThreshold.min)} to ${String(limits.repeatOrderThreshold.max)}. Empty keeps the current one.`}
            value={texts.repeatOrderThreshold}
            error={errorOf('repeatOrderThreshold')}
          />
          <RuleField
            {...shared}
            field="highSpend"
            label={tx('High spender from')}
            unit="৳ taka"
            decimal
            hint={tx(
              'Total spend from which a customer counts as a high spender. Empty keeps the current one.',
            )}
            value={texts.highSpend}
            error={errorOf('highSpend')}
          />
          <RuleField
            {...shared}
            field="inactiveDays"
            label={tx('Inactive after')}
            unit="days"
            hint={`Days without an order after which a customer counts as inactive. ${String(limits.inactiveDays.min)} to ${String(limits.inactiveDays.max)}. Empty keeps the current one.`}
            value={texts.inactiveDays}
            error={errorOf('inactiveDays')}
          />
        </div>
      </fieldset>

      <div className="grid gap-3">
        <ActionFeedback state={state} />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Saving…" className="max-sm:min-h-11">
            <Save aria-hidden="true" strokeWidth={1.75} />
            <AutoText>Save store rules</AutoText>
          </SubmitButton>
          {dirty ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
              <AutoText>Unsaved changes</AutoText>
            </p>
          ) : null}
        </div>
      </div>
    </form>
  );
}
