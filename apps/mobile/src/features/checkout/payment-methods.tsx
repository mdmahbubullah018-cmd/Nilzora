import { PAYMENT_METHODS, type PaymentMethodId } from '@nilzora/contracts';
import { Banknote, Smartphone, Wallet, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/card';
import { SectionHeader } from '@/components/section-header';
import { theme } from '@/theme';

/*
 * The payment step of the app's checkout.
 *
 * Cash on delivery is the only method that works, and the only one that can be chosen. bKash
 * and Nagad appear in their own brand colours with a "Coming soon" badge and no way to select
 * them: nothing is sent for a method without a gateway, and the order function only ever
 * accepts cash. The chosen state is fixed, so there is no radio to mis-tap.
 */

const ICONS: Record<PaymentMethodId, LucideIcon> = {
  cod: Banknote,
  bkash: Wallet,
  nagad: Smartphone,
};

const BRAND: Record<PaymentMethodId, string> = {
  cod: theme.colors.link,
  bkash: '#E2136E',
  nagad: '#EE1C25',
};

export function PaymentMethods({ codAvailable }: { codAvailable: boolean }) {
  return (
    <View style={styles.section}>
      <SectionHeader title="Payment" step={3} />
      <View style={styles.list}>
        {PAYMENT_METHODS.map((method) => {
          const selectable = method.status === 'available' && (method.id !== 'cod' || codAvailable);
          const Icon = ICONS[method.id];
          return (
            <View
              key={method.id}
              accessible
              accessibilityRole="text"
              accessibilityLabel={[
                method.label,
                method.status === 'available'
                  ? codAvailable
                    ? 'available'
                    : 'switched off'
                  : 'coming soon, not available',
                method.description,
              ].join('. ')}
            >
              <Card style={[styles.card, selectable ? styles.cardActive : styles.cardDisabled]}>
                <View style={[styles.icon, { backgroundColor: `${BRAND[method.id]}1A` }]}>
                  <Icon size={20} color={BRAND[method.id]} accessible={false} />
                </View>
                <View style={styles.body}>
                  <View style={styles.titleRow}>
                    <Text style={styles.method}>{method.label}</Text>
                    {method.status === 'available' ? (
                      <Text style={styles.available}>{codAvailable ? 'Available' : 'Off'}</Text>
                    ) : (
                      <Text style={[styles.soon, { color: BRAND[method.id], backgroundColor: `${BRAND[method.id]}1F` }]}>
                        {method.badge ?? 'Coming soon'}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.note}>
                    {method.status === 'available' ? method.description : `${method.description} Not available yet.`}
                  </Text>
                </View>
                {selectable ? (
                  <View style={styles.check} accessible={false}>
                    <View style={styles.checkDot} />
                  </View>
                ) : null}
              </Card>
            </View>
          );
        })}
      </View>
      <Text style={styles.footnote}>
        {codAvailable
          ? 'bKash and Nagad are coming soon. Until then every order is paid in cash on delivery.'
          : 'Cash on delivery is switched off right now, so orders cannot be placed.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.spacing[2] },
  list: { gap: theme.spacing[2] },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  cardActive: { borderColor: theme.notice.info.border, backgroundColor: theme.notice.info.surface },
  cardDisabled: { borderStyle: 'dashed', backgroundColor: theme.colors.surfaceMuted },
  icon: {
    width: 40,
    height: 40,
    borderRadius: theme.radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2], flexWrap: 'wrap' },
  method: { color: theme.colors.foreground, fontSize: 15, fontWeight: theme.fontWeights.semibold },
  available: {
    color: theme.notice.success.foreground,
    backgroundColor: theme.notice.success.surface,
    borderRadius: theme.radii.full,
    paddingHorizontal: 8,
    paddingVertical: 1,
    fontSize: 11,
    fontWeight: theme.fontWeights.semibold,
    overflow: 'hidden',
  },
  soon: {
    borderRadius: theme.radii.full,
    paddingHorizontal: 8,
    paddingVertical: 1,
    fontSize: 11,
    fontWeight: theme.fontWeights.semibold,
    overflow: 'hidden',
  },
  note: { color: theme.colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: theme.colors.link,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.link },
  footnote: { color: theme.colors.mutedForeground, fontSize: 12, lineHeight: 17 },
});
