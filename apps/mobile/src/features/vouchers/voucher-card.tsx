import type { Voucher } from '@nilzora/contracts';
import { CalendarClock, CheckCircle2, ShoppingBag } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { formatMoney } from '@/lib/money';
import { theme } from '@/theme';

/*
 * A voucher as a native ticket: the discount on a primary stub, the conditions beside it and
 * a dashed perforation between them. A voucher that is over or used stays readable but fades.
 */

const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Dhaka',
});

export function voucherDiscount(voucher: Pick<Voucher, 'kind' | 'value'>): string {
  if (voucher.kind === 'free_delivery') return 'FREE';
  return voucher.kind === 'percent' ? `${String(voucher.value)}%` : formatMoney(voucher.value);
}

export function voucherConditions(voucher: Voucher): string {
  const parts = [
    voucher.minOrderMinor > 0 ? `Min. spend ${formatMoney(voucher.minOrderMinor)}` : 'No minimum spend',
  ];
  if (voucher.kind === 'percent' && voucher.maxDiscountMinor !== null) {
    parts.push(`up to ${formatMoney(voucher.maxDiscountMinor)} off`);
  }
  return parts.join(' · ');
}

export function voucherEligibility(voucher: Voucher): string {
  if (voucher.scope === 'categories') {
    const names = voucher.categories.map((category) => category.name);
    return names.length > 0 ? `On ${names.slice(0, 2).join(', ')}${names.length > 2 ? ' and more' : ''}` : 'On selected categories';
  }
  if (voucher.scope === 'products') {
    return voucher.products.length === 1 ? `On ${voucher.products[0]?.name ?? 'one product'}` : 'On selected products';
  }
  return 'On everything in the store';
}

function validity(voucher: Voucher): string {
  if (voucher.state === 'upcoming' && voucher.startsAt) return `Starts ${DATE.format(new Date(voucher.startsAt))}`;
  if (!voucher.endsAt) return 'No expiry date';
  const date = DATE.format(new Date(voucher.endsAt));
  return voucher.state === 'expired' ? `Expired ${date}` : `Valid until ${date}`;
}

const STATE_LABEL: Partial<Record<Voucher['state'], string>> = {
  used: 'Used',
  expired: 'Expired',
  upcoming: 'Coming soon',
  fully_collected: 'All collected',
};

export function VoucherTicket({ voucher, action }: { voucher: Voucher; action: ReactNode }) {
  const faded = voucher.state === 'expired' || voucher.state === 'used' || voucher.state === 'fully_collected';
  return (
    <View
      accessible={false}
      style={[styles.card, faded && styles.faded]}
      testID={`voucher-${voucher.id}`}
    >
      <View style={styles.stub}>
        <Text style={styles.stubEyebrow}>VOUCHER</Text>
        <Text style={styles.stubValue} adjustsFontSizeToFit numberOfLines={1}>
          {voucherDiscount(voucher)}
        </Text>
        <Text style={styles.stubOff}>{voucher.kind === 'free_delivery' ? 'DELIVERY' : 'OFF'}</Text>
        <View style={[styles.notch, styles.notchTop]} />
        <View style={[styles.notch, styles.notchBottom]} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={2}>
            {voucher.title}
          </Text>
          {STATE_LABEL[voucher.state] ? (
            <Text style={styles.stateChip}>{STATE_LABEL[voucher.state]}</Text>
          ) : null}
        </View>
        <Text style={styles.meta}>{voucherConditions(voucher)}</Text>
        <View style={styles.line}>
          <ShoppingBag size={14} color={theme.colors.mutedForeground} />
          <Text style={styles.small} numberOfLines={1}>
            {voucherEligibility(voucher)}
          </Text>
        </View>
        <View style={styles.footer}>
          <View style={[styles.line, styles.shrink]}>
            <CalendarClock size={14} color={theme.colors.mutedForeground} />
            <Text style={styles.small} numberOfLines={1}>
              {validity(voucher)}
            </Text>
          </View>
          {voucher.state === 'used' ? (
            <View style={styles.line}>
              <CheckCircle2 size={16} color={theme.colors.mutedForeground} />
              <Text style={styles.usedText}>Used</Text>
            </View>
          ) : (
            action
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    minHeight: 132,
    borderRadius: theme.radii.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden',
    ...theme.shadow.card,
  },
  faded: { opacity: 0.55 },
  stub: {
    width: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: theme.spacing[2],
    backgroundColor: theme.colors.primary,
    borderRightWidth: 2,
    borderRightColor: 'rgba(255,255,255,0.55)',
    borderStyle: 'dashed',
  },
  stubEyebrow: { color: '#E0F2FE', fontSize: 10, fontWeight: '600', letterSpacing: 1.8 },
  stubValue: { color: '#FFFFFF', fontSize: 24, lineHeight: 28, fontWeight: '800', letterSpacing: -0.5 },
  stubOff: { color: '#FFFFFF', fontSize: 11, fontWeight: '600', letterSpacing: 1.4 },
  notch: {
    position: 'absolute',
    right: -10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: theme.colors.background,
  },
  notchTop: { top: -10 },
  notchBottom: { bottom: -10 },
  body: { flex: 1, padding: theme.spacing[4], gap: theme.spacing[2], justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing[2] },
  title: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
    lineHeight: 20,
  },
  stateChip: {
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 3,
    backgroundColor: theme.colors.surfaceMuted,
    color: theme.colors.mutedForeground,
    fontSize: 11,
    fontWeight: theme.fontWeights.semibold,
  },
  meta: { color: theme.colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1 },
  small: { color: theme.colors.mutedForeground, fontSize: 12, flexShrink: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.spacing[2] },
  usedText: { color: theme.colors.mutedForeground, fontSize: 13, fontWeight: '700' },
});
