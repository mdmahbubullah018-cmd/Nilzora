import { Ticket } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/button';
import { useOnline } from '@/network/connectivity';
import { theme } from '@/theme';

export interface CouponFieldProps {
  /** The code currently typed (or the applied one). */
  value: string;
  onChangeText: (value: string) => void;
  /** Applies the typed code: the quote is asked again with it. */
  onApply: () => void;
  /** Drops the applied code and prices the cart without it. */
  onRemove: () => void;
  /** The code the server applied, when one did. */
  appliedCode: string | null;
  /** Why the last code did not apply, as the API explained it. */
  problem: string | null;
  /** The discount in words, e.g. "−৳120", when a code applied. */
  discountLabel: string | null;
  /** Prices are being fetched, so applying again would be a guess. */
  busy: boolean;
  editable: boolean;
  /**
   * Collected vouchers that can be used now. Choosing one applies its code through the same
   * single slot as a typed code: an order carries one voucher or one code, never both.
   */
  vouchers?: readonly { code: string; title: string; summary: string }[];
  onPickVoucher?: (code: string) => void;
  /** True when the applied code is a collected voucher. */
  appliedIsVoucher?: boolean;
  /** The applied voucher's title, shown instead of its code. */
  appliedTitle?: string | null;
}

/**
 * The coupon code on checkout. The device only carries the code: the discount shown on
 * the summary is the one the API calculated, and applying a code always asks it again.
 */
export function CouponField({
  value,
  onChangeText,
  onApply,
  onRemove,
  appliedCode,
  problem,
  discountLabel,
  busy,
  editable,
  vouchers = [],
  onPickVoucher,
  appliedIsVoucher = false,
  appliedTitle = null,
}: CouponFieldProps) {
  const online = useOnline();
  return (
    <View style={styles.section}>
      <Text style={styles.label}>Voucher or coupon</Text>
      <Text style={styles.help}>Use one voucher or one coupon code on this order.</Text>
      {appliedCode !== null ? (
        <View style={styles.applied}>
          <Text style={styles.appliedText}>
            {appliedIsVoucher ? `Voucher: ${appliedTitle ?? 'applied'}` : appliedCode}
            {discountLabel === null ? '' : ` · ${discountLabel}`}
          </Text>
          <Button
            label="Remove"
            variant="secondary"
            onPress={onRemove}
            disabled={busy || !editable}
            accessibilityHint="Removes the coupon and updates the total"
          />
        </View>
      ) : null}
      {problem !== null ? (
        <Text accessibilityLiveRegion="polite" style={styles.problem}>
          {problem}
        </Text>
      ) : null}
      {vouchers.length > 0 && onPickVoucher ? (
        <View style={styles.vouchers}>
          <Text style={styles.subLabel}>Your vouchers</Text>
          {vouchers.map((voucher) => {
            const chosen = appliedCode === voucher.code;
            return (
              <Pressable
                key={voucher.code}
                accessibilityRole="button"
                accessibilityLabel={`${voucher.title}, ${voucher.summary}`}
                accessibilityHint={
                  chosen ? 'This voucher is applied' : 'Applies this voucher and updates the total'
                }
                accessibilityState={{ selected: chosen, disabled: !editable || busy }}
                disabled={!editable || busy || chosen}
                onPress={() => onPickVoucher(voucher.code)}
                style={[styles.voucher, chosen && styles.voucherChosen]}
              >
                <Ticket size={18} color={theme.colors.primary} />
                <View style={styles.voucherText}>
                  <Text style={styles.voucherTitle} numberOfLines={1}>
                    {voucher.title}
                  </Text>
                  <Text style={styles.voucherSummary} numberOfLines={1}>
                    {voucher.summary}
                  </Text>
                </View>
                <Text style={styles.voucherAction}>{chosen ? 'Applied' : 'Use'}</Text>
              </Pressable>
            );
          })}
          <Text style={styles.subLabel}>Or enter a coupon code</Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          editable={editable && !busy}
          placeholder="Enter a code"
          placeholderTextColor={theme.colors.mutedForeground}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={32}
          accessibilityLabel="Coupon code"
          style={styles.input}
        />
        <Button
          label={appliedCode === null ? 'Apply' : 'Update'}
          variant="secondary"
          onPress={onApply}
          loading={busy}
          disabled={!editable || busy || !online || value.trim() === ''}
          accessibilityHint="Checks the code and updates the total"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.spacing[2] },
  label: { color: theme.colors.foreground, fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  input: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.input,
    paddingHorizontal: theme.spacing[3],
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface,
    fontSize: 15,
    letterSpacing: 1,
  },
  applied: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.radii.input,
    backgroundColor: theme.notice.success.surface,
  },
  appliedText: { color: theme.colors.foreground, fontSize: 14, fontWeight: '600' },
  problem: { color: theme.colors.warning, fontSize: 13, lineHeight: 18 },
  help: { color: theme.colors.mutedForeground, fontSize: 13 },
  vouchers: { gap: theme.spacing[2] },
  subLabel: { color: theme.colors.foreground, fontSize: 13, fontWeight: '600' },
  voucher: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    minHeight: 56,
    paddingHorizontal: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.input,
    backgroundColor: theme.colors.surface,
  },
  voucherChosen: { borderColor: theme.colors.primary, backgroundColor: theme.colors.iconSurface },
  voucherText: { flex: 1, gap: 2 },
  voucherTitle: { color: theme.colors.foreground, fontSize: 14, fontWeight: '600' },
  voucherSummary: { color: theme.colors.mutedForeground, fontSize: 12 },
  voucherAction: { color: theme.colors.primary, fontSize: 14, fontWeight: '700' },
});
