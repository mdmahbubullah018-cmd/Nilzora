import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { theme } from '@/theme';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Styles the confirm button as a destructive action. */
  destructive?: boolean;
  /** Shows progress on the confirm button and ignores further taps until it ends. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A centred confirmation. The Android back button and a tap outside cancel it, except while
 * the action is running. The cancel button comes first so the safe choice is the easy one.
 */
export function ConfirmDialog({
  visible,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancel = () => {
    if (!busy) onCancel();
  };
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={cancel}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          onPress={cancel}
          style={StyleSheet.absoluteFill}
        />
        <View accessibilityViewIsModal style={styles.dialog}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <View style={styles.body}>{children}</View>
          <View style={styles.actions}>
            <Button label={cancelLabel} variant="secondary" disabled={busy} onPress={cancel} />
            <Button
              label={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              loading={busy}
              onPress={onConfirm}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: theme.spacing[5],
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  dialog: {
    gap: theme.spacing[4],
    padding: theme.spacing[5],
    borderRadius: theme.radii.xl,
    backgroundColor: theme.colors.surface,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: 18,
    fontWeight: theme.fontWeights.semibold,
  },
  body: { gap: theme.spacing[2] },
  actions: { gap: theme.spacing[3] },
});
