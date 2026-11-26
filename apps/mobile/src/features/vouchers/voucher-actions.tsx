import type { Voucher } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { authHref } from '@/lib/return-to';
import { useSignedInUserId } from '@/auth/session-context';
import { useOnline } from '@/network/connectivity';
import { describeApiError } from '@/lib/errors';
import { theme } from '@/theme';
import { useCollectVoucher, voucherUseHref } from './voucher-hooks';

/**
 * The ticket's action: Sign in to collect, Collect, or Use. Collect turns into Use only once
 * the server confirmed it; a refusal keeps Collect and says why below it. `onCollected` lets a
 * parent (the product voucher sheet) keep its own strip in step with the ticket.
 */
export function VoucherAction({
  voucher,
  returnTo,
  onCollected,
}: {
  voucher: Voucher;
  returnTo: string;
  onCollected?: () => void;
}) {
  const router = useRouter();
  const userId = useSignedInUserId();
  const collect = useCollectVoucher();
  const [message, setMessage] = useState<string | null>(null);
  const online = useOnline();

  if (voucher.state === 'collected') {
    return (
      <Pill
        label="Use"
        outline
        hint="Shows the products this voucher applies to"
        onPress={() => router.push(voucherUseHref(voucher))}
      />
    );
  }
  if (voucher.state !== 'available') return null;
  if (userId === null) {
    return (
      <Pill
        label="Sign in"
        hint="Sign in to collect this voucher"
        onPress={() => router.push(authHref('/sign-in', returnTo))}
      />
    );
  }
  return (
    <View style={styles.collect}>
      <Pill
        label="Collect"
        loading={collect.isPending}
        disabled={!online}
        hint={
          online
            ? 'Saves this voucher to your account'
            : 'You are offline. Collecting needs a connection'
        }
        onPress={() => {
          setMessage(null);
          collect.mutate(voucher.id, {
            onSuccess: () => {
              onCollected?.();
            },
            onError: (error) => {
              setMessage(
                (error as { code?: string }).code === 'voucher_unavailable'
                  ? 'This voucher cannot be collected on your account right now.'
                  : describeApiError(error).message,
              );
            },
          });
        }}
      />
      {message ? (
        <Text accessibilityLiveRegion="polite" style={styles.message}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

function Pill({
  label,
  onPress,
  outline = false,
  loading = false,
  disabled = false,
  hint,
}: {
  label: string;
  onPress: () => void;
  outline?: boolean;
  loading?: boolean;
  disabled?: boolean;
  hint: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ busy: loading, disabled: loading || disabled }}
      disabled={loading || disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.pill,
        outline ? styles.pillOutline : styles.pillSolid,
        pressed && (outline ? styles.pillOutlinePressed : styles.pillSolidPressed),
        disabled ? { opacity: 0.5 } : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={theme.colors.primaryActionForeground} size="small" />
      ) : (
        <Text style={[styles.pillText, outline && styles.pillTextOutline]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  collect: { alignItems: 'flex-end', gap: 4, flexShrink: 0 },
  message: { maxWidth: 180, color: theme.colors.fieldError, fontSize: 12, textAlign: 'right' },
  pill: {
    minHeight: 40,
    minWidth: 84,
    paddingHorizontal: theme.spacing[4],
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSolid: { backgroundColor: theme.colors.primaryAction },
  pillSolidPressed: { backgroundColor: theme.colors.primaryActionHover },
  pillOutline: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.surface,
  },
  pillOutlinePressed: { backgroundColor: theme.colors.iconSurface },
  pillText: { color: theme.colors.primaryActionForeground, fontSize: 14, fontWeight: '700' },
  pillTextOutline: { color: theme.colors.primary },
});
