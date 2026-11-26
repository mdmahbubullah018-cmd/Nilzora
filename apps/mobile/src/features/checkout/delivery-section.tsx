import { MAX_ADDRESSES, type Address } from '@nilzora/contracts';
import { ArrowLeftRight, Check, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/card';
import { SectionHeader } from '@/components/section-header';
import { AddressDetails, CardAction, DefaultBadge } from '@/features/addresses/address-card';
import { addressTitle, DELIVERY_ZONE_LABELS } from '@/features/addresses/address-format';
import { theme } from '@/theme';

export interface DeliverySectionProps {
  addresses: readonly Address[];
  selected: Address;
  onSelect: (addressId: string) => void;
  onAddAddress: () => void;
  /** An order is being placed: the address cannot change. */
  locked: boolean;
}

/** The address the order goes to, a way to pick another one, and a way to add a new one. */
export function DeliverySection({
  addresses,
  selected,
  onSelect,
  onAddAddress,
  locked,
}: DeliverySectionProps) {
  const [choosing, setChoosing] = useState(false);

  return (
    <View style={styles.section}>
      <SectionHeader title="Delivery address" step={1} />
      <Card style={styles.card}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{addressTitle(selected)}</Text>
          {selected.isDefault ? <DefaultBadge /> : null}
        </View>
        <AddressDetails address={selected} />
        <Text style={styles.zone}>
          Delivery zone: {DELIVERY_ZONE_LABELS[selected.deliveryZone]}
        </Text>
        <View style={styles.actions}>
          {addresses.length > 1 ? (
            <CardAction
              icon={ArrowLeftRight}
              label={choosing ? 'Keep this address' : 'Change'}
              accessibilityLabel={
                choosing ? 'Keep this delivery address' : 'Change the delivery address'
              }
              disabled={locked}
              onPress={() => {
                setChoosing((current) => !current);
              }}
            />
          ) : null}
          {addresses.length < MAX_ADDRESSES ? (
            <CardAction
              icon={Plus}
              label="Add a new address"
              accessibilityLabel="Add a new address"
              disabled={locked}
              onPress={onAddAddress}
            />
          ) : null}
        </View>
      </Card>

      {choosing ? (
        <View accessibilityRole="radiogroup" style={styles.options}>
          {addresses.map((address) => {
            const isSelected = address.id === selected.id;
            const place = `${address.area}, ${address.district}`;
            return (
              <Pressable
                key={address.id}
                accessibilityRole="radio"
                accessibilityLabel={`${addressTitle(address)}, ${place}`}
                accessibilityState={{ checked: isSelected, disabled: locked }}
                disabled={locked}
                onPress={() => {
                  onSelect(address.id);
                  setChoosing(false);
                }}
                style={({ pressed }) => [
                  styles.option,
                  isSelected ? styles.optionSelected : null,
                  pressed ? styles.optionPressed : null,
                ]}
              >
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>{addressTitle(address)}</Text>
                  <Text style={styles.optionLine}>
                    {address.label ? `${address.recipientName} · ${place}` : place}
                  </Text>
                </View>
                {isSelected ? (
                  <Check size={20} color={theme.colors.link} accessible={false} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.spacing[2] },
  card: { padding: theme.spacing[4], gap: theme.spacing[3] },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.spacing[2] },
  title: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: 16,
    fontWeight: theme.fontWeights.semibold,
  },
  zone: { color: theme.colors.mutedForeground, fontSize: 13 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
    marginHorizontal: -theme.spacing[2],
    paddingTop: theme.spacing[1],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  options: { gap: theme.spacing[2] },
  option: {
    minHeight: theme.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    padding: theme.spacing[3],
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  optionSelected: { borderColor: theme.colors.link, borderWidth: 2 },
  optionPressed: { backgroundColor: theme.colors.surfaceMuted },
  optionText: { flex: 1, gap: 2 },
  optionTitle: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
  },
  optionLine: { color: theme.colors.body, fontSize: 14, lineHeight: 20 },
});
