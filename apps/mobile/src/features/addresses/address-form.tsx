import { BD_DISTRICTS, BD_DIVISIONS, isDistrictOf, type AddressInput } from '@nilzora/contracts';
import { useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  type LayoutChangeEvent,
  type ScrollViewInstance,
  type TextInputInstance,
} from 'react-native';
import { Button } from '@/components/button';
import { Notice } from '@/components/notice';
import { ScreenFrame, STACK_EDGES } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { theme } from '@/theme';
import {
  firstErrorField,
  validateAddressForm,
  type AddressField,
  type AddressFieldErrors,
  type AddressFormValues,
} from './address-form-model';
import { OptionPicker } from './option-picker';

/** What the screen reports back after trying to save. */
export type AddressSubmitResult =
  { ok: true } | { ok: false; title?: string; message: string; fieldErrors?: AddressFieldErrors };

export interface AddressFormProps {
  initial: AddressFormValues;
  /**
   * `offer` shows the default switch. The default only moves to another address, so it is
   * not offered for the current default (`current`) or for a first address (`first`),
   * which becomes the default anyway.
   */
  defaultChoice: 'offer' | 'current' | 'first';
  submitLabel: string;
  onSubmit: (input: AddressInput) => Promise<AddressSubmitResult>;
}

/** Remembers where a field sits, so the first one with an error can be scrolled into view. */
function Anchor({
  field,
  onMeasured,
  children,
}: {
  field: AddressField;
  onMeasured: (field: AddressField, y: number) => void;
  children: ReactNode;
}) {
  return (
    <View
      onLayout={(event: LayoutChangeEvent) => {
        onMeasured(field, event.nativeEvent.layout.y);
      }}
    >
      {children}
    </View>
  );
}

const CHECK_FIELDS = 'Check the highlighted fields.';
const SCROLL_MARGIN = 24;

type TextFieldName = Exclude<AddressField, 'division' | 'district'>;

function districtsOf(division: string): readonly string[] {
  return Object.hasOwn(BD_DISTRICTS, division)
    ? BD_DISTRICTS[division as keyof typeof BD_DISTRICTS]
    : [];
}

/**
 * The form shared by "New address" and "Edit address". Fields are checked with the shared
 * contract before anything is sent, and the API's own field messages are shown on the same
 * fields. Pressing Next moves through the text fields, the first field with an error is
 * scrolled into view and focused, and a second tap while saving is ignored.
 */
export function AddressForm({ initial, defaultChoice, submitLabel, onSubmit }: AddressFormProps) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<AddressFieldErrors>({});
  const [formError, setFormError] = useState<{ title?: string; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submitGuard = useRef(false);

  const scrollRef = useRef<ScrollViewInstance>(null);
  const fieldsTop = useRef(0);
  const positions = useRef<Partial<Record<AddressField, number>>>({});
  const recipientRef = useRef<TextInputInstance>(null);
  const phoneRef = useRef<TextInputInstance>(null);
  const areaRef = useRef<TextInputInstance>(null);
  const addressLineRef = useRef<TextInputInstance>(null);
  const postalCodeRef = useRef<TextInputInstance>(null);
  const landmarkRef = useRef<TextInputInstance>(null);
  const labelRef = useRef<TextInputInstance>(null);
  const inputs: Record<TextFieldName, RefObject<TextInputInstance | null>> = {
    recipientName: recipientRef,
    phone: phoneRef,
    area: areaRef,
    addressLine: addressLineRef,
    postalCode: postalCodeRef,
    landmark: landmarkRef,
    label: labelRef,
  };

  function recordPosition(field: AddressField, y: number) {
    positions.current[field] = y;
  }

  function setText(field: AddressField, text: string) {
    setValues((current) => ({ ...current, [field]: text }));
    setErrors((current) =>
      current[field] === undefined ? current : { ...current, [field]: undefined },
    );
  }

  function setDivision(division: string) {
    setValues((current) => ({
      ...current,
      division,
      // A district of another division no longer fits.
      district: isDistrictOf(division, current.district) ? current.district : '',
    }));
    setErrors((current) => ({ ...current, division: undefined, district: undefined }));
  }

  function showErrors(next: AddressFieldErrors, message: { title?: string; message: string }) {
    setErrors(next);
    setFormError(message);
    const first = firstErrorField(next);
    if (first === null) return;
    const y = (positions.current[first] ?? 0) + fieldsTop.current;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - SCROLL_MARGIN), animated: true });
    if (first !== 'division' && first !== 'district') inputs[first].current?.focus();
  }

  async function submit() {
    if (submitGuard.current) return;
    const checked = validateAddressForm(values);
    if (!checked.ok) {
      showErrors(checked.errors, { message: CHECK_FIELDS });
      return;
    }
    submitGuard.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const outcome = await onSubmit(checked.input);
      if (!outcome.ok) {
        showErrors(outcome.fieldErrors ?? {}, { title: outcome.title, message: outcome.message });
        if (firstErrorField(outcome.fieldErrors ?? {}) === null) {
          void AccessibilityInfo.announceForAccessibility(outcome.message);
        }
      }
    } finally {
      submitGuard.current = false;
      setSubmitting(false);
    }
  }

  const divisionChosen = Object.hasOwn(BD_DISTRICTS, values.division);

  return (
    <ScreenFrame edges={STACK_EDGES}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {formError ? (
          <Notice tone="danger" title={formError.title}>
            {formError.message}
          </Notice>
        ) : null}

        <View
          style={styles.fields}
          onLayout={(event) => {
            fieldsTop.current = event.nativeEvent.layout.y;
          }}
        >
          <Anchor field="recipientName" onMeasured={recordPosition}>
            <TextField
              ref={recipientRef}
              label="Recipient name"
              value={values.recipientName}
              onChangeText={(text) => {
                setText('recipientName', text);
              }}
              error={errors.recipientName}
              autoComplete="name"
              textContentType="name"
              autoCapitalize="words"
              maxLength={120}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => phoneRef.current?.focus()}
            />
          </Anchor>
          <Anchor field="phone" onMeasured={recordPosition}>
            <TextField
              ref={phoneRef}
              label="Mobile phone"
              hint="The courier calls this number, e.g. 01712-345678."
              value={values.phone}
              onChangeText={(text) => {
                setText('phone', text);
              }}
              error={errors.phone}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              maxLength={20}
              returnKeyType="done"
            />
          </Anchor>
          <Anchor field="division" onMeasured={recordPosition}>
            <OptionPicker
              label="Division"
              placeholder="Choose a division"
              value={values.division}
              options={BD_DIVISIONS}
              onChange={setDivision}
              error={errors.division}
            />
          </Anchor>
          <Anchor field="district" onMeasured={recordPosition}>
            <OptionPicker
              label="District"
              placeholder="Choose a district"
              value={values.district}
              options={districtsOf(values.division)}
              onChange={(district) => {
                setText('district', district);
              }}
              error={errors.district}
              disabled={!divisionChosen}
              disabledHint="Choose a division first"
              searchable
            />
          </Anchor>
          <Anchor field="area" onMeasured={recordPosition}>
            <TextField
              ref={areaRef}
              label="Area, thana or upazila"
              value={values.area}
              onChangeText={(text) => {
                setText('area', text);
              }}
              error={errors.area}
              autoComplete="address-line2"
              maxLength={80}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => addressLineRef.current?.focus()}
            />
          </Anchor>
          <Anchor field="addressLine" onMeasured={recordPosition}>
            <TextField
              ref={addressLineRef}
              label="House, road and block"
              hint="e.g. House 12, Road 5, Block C"
              value={values.addressLine}
              onChangeText={(text) => {
                setText('addressLine', text);
              }}
              error={errors.addressLine}
              autoComplete="address-line1"
              textContentType="streetAddressLine1"
              maxLength={200}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => postalCodeRef.current?.focus()}
            />
          </Anchor>
          <Anchor field="postalCode" onMeasured={recordPosition}>
            <TextField
              ref={postalCodeRef}
              label="Postal code"
              optional
              value={values.postalCode}
              onChangeText={(text) => {
                setText('postalCode', text);
              }}
              error={errors.postalCode}
              keyboardType="number-pad"
              autoComplete="postal-code"
              textContentType="postalCode"
              maxLength={4}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => landmarkRef.current?.focus()}
            />
          </Anchor>
          <Anchor field="landmark" onMeasured={recordPosition}>
            <TextField
              ref={landmarkRef}
              label="Nearby landmark"
              optional
              value={values.landmark}
              onChangeText={(text) => {
                setText('landmark', text);
              }}
              error={errors.landmark}
              maxLength={120}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => labelRef.current?.focus()}
            />
          </Anchor>
          <Anchor field="label" onMeasured={recordPosition}>
            <TextField
              ref={labelRef}
              label="Label"
              optional
              hint="A name to recognise it by, e.g. Home or Office."
              value={values.label}
              onChangeText={(text) => {
                setText('label', text);
              }}
              error={errors.label}
              maxLength={40}
              returnKeyType="done"
            />
          </Anchor>
        </View>

        {defaultChoice === 'offer' ? (
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Use as my default delivery address"
            accessibilityState={{ checked: values.isDefault }}
            onPress={() => {
              setValues((current) => ({ ...current, isDefault: !current.isDefault }));
            }}
            style={styles.switchRow}
          >
            <Text aria-hidden style={styles.switchLabel}>
              Use as my default delivery address
            </Text>
            <Switch
              accessible={false}
              importantForAccessibility="no"
              pointerEvents="none"
              value={values.isDefault}
              trackColor={{ false: theme.colors.borderStrong, true: theme.colors.primaryAction }}
              thumbColor="#FFFFFF"
            />
          </Pressable>
        ) : (
          <Text style={styles.note}>
            {defaultChoice === 'current'
              ? 'This is your default delivery address.'
              : 'Your first address becomes your default delivery address.'}
          </Text>
        )}

        <Button label={submitLabel} loading={submitting} onPress={() => void submit()} />
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: theme.spacing[5],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[10],
    gap: theme.spacing[5],
  },
  fields: { gap: theme.spacing[5] },
  switchRow: {
    minHeight: theme.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[4],
  },
  switchLabel: { flex: 1, color: theme.colors.foreground, fontSize: 15 },
  note: { color: theme.colors.mutedForeground, fontSize: 14, lineHeight: 20 },
});
