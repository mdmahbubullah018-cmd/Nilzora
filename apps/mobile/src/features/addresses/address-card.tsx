import type { Address } from '@nilzora/contracts';
import { Pencil, Star, Trash2, type LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/card';
import { theme } from '@/theme';
import {
  addressLines,
  addressSummary,
  addressTitle,
  DELIVERY_ZONE_LABELS,
  formatBdPhone,
} from './address-format';

/**
 * The recipient, the address as written on a parcel and the phone. Under a heading that
 * already is the recipient's name (an address without a label) the name is not repeated.
 */
export function AddressDetails({ address }: { address: Address }) {
  return (
    <View style={styles.details}>
      {address.label === null ? null : (
        <Text style={styles.recipient}>{address.recipientName}</Text>
      )}
      {addressLines(address).map((line, index) => (
        // Lines can repeat each other's text; their order never changes, so position is the key.
        <Text key={index} style={styles.line}>
          {line}
        </Text>
      ))}
      <Text accessibilityLabel={`Phone: ${formatBdPhone(address.phone)}`} style={styles.line}>
        {formatBdPhone(address.phone)}
      </Text>
    </View>
  );
}

export function DefaultBadge() {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>Default</Text>
    </View>
  );
}

/** A compact text button (48dp tall) for the actions at the foot of a card. */
export function CardAction({
  icon: Icon,
  label,
  accessibilityLabel,
  tone = 'neutral',
  loading = false,
  disabled = false,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  accessibilityLabel: string;
  tone?: 'neutral' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const color = tone === 'danger' ? theme.colors.dangerAction : theme.colors.link;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        pressed && !inactive ? styles.actionPressed : null,
        disabled && !loading ? styles.actionDisabled : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Icon size={18} color={color} accessible={false} />
      )}
      <Text style={[styles.actionText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export interface AddressCardProps {
  address: Address;
  /** Another change to this address is running: its buttons wait. */
  busy?: boolean;
  makingDefault?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMakeDefault: () => void;
}

/** One saved address in the address book, with its edit, delete and default controls. */
export function AddressCard({
  address,
  busy = false,
  makingDefault = false,
  onEdit,
  onDelete,
  onMakeDefault,
}: AddressCardProps) {
  const name = addressSummary(address);
  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          {addressTitle(address)}
        </Text>
        {address.isDefault ? <DefaultBadge /> : null}
      </View>
      <AddressDetails address={address} />
      <Text style={styles.zone}>Delivery zone: {DELIVERY_ZONE_LABELS[address.deliveryZone]}</Text>
      <View style={styles.actions}>
        <CardAction
          icon={Pencil}
          label="Edit"
          accessibilityLabel={`Edit ${name}`}
          disabled={busy}
          onPress={onEdit}
        />
        {address.isDefault ? null : (
          <CardAction
            icon={Star}
            label="Set as default"
            accessibilityLabel={`Set ${name} as default`}
            loading={makingDefault}
            disabled={busy}
            onPress={onMakeDefault}
          />
        )}
        <CardAction
          icon={Trash2}
          label="Delete"
          accessibilityLabel={`Delete ${name}`}
          tone="danger"
          disabled={busy}
          onPress={onDelete}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: theme.spacing[4], gap: theme.spacing[3] },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing[2] },
  title: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: 16,
    fontWeight: theme.fontWeights.semibold,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: theme.radii.full,
    backgroundColor: theme.colors.infoSurface,
  },
  badgeText: {
    color: theme.colors.infoForeground,
    fontSize: 12,
    fontWeight: theme.fontWeights.semibold,
  },
  details: { gap: 2 },
  recipient: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
  },
  line: { color: theme.colors.body, fontSize: 14, lineHeight: 20 },
  zone: { color: theme.colors.mutedForeground, fontSize: 13 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
    marginHorizontal: -theme.spacing[2],
    paddingTop: theme.spacing[1],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  action: {
    minHeight: theme.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.radii.md,
  },
  actionPressed: { backgroundColor: theme.colors.surfaceMuted },
  actionDisabled: { opacity: 0.5 },
  actionText: { fontSize: 14, fontWeight: theme.fontWeights.semibold },
});
