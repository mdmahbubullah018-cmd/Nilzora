import type { ChatConversationStatus } from '@nilzora/contracts';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';

/*
 * A thread's state in a word, coloured to match: open (blue), in progress (amber), resolved
 * (green), closed (grey). The word carries the meaning; the colour only reinforces it.
 */

export const SUPPORT_STATUS_LABEL: Record<ChatConversationStatus, string> = {
  open: 'Open',
  pending: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

const TONE: Record<
  ChatConversationStatus,
  { surface: string; border: string; foreground: string }
> = {
  open: theme.notice.info,
  pending: theme.notice.warning,
  resolved: theme.notice.success,
  closed: {
    surface: theme.colors.surfaceMuted,
    border: theme.colors.border,
    foreground: theme.colors.mutedForeground,
  },
};

export function StatusPill({ status }: { status: ChatConversationStatus }) {
  const tone = TONE[status];
  return (
    <View
      accessible={false}
      style={[styles.pill, { backgroundColor: tone.surface, borderColor: tone.border }]}
    >
      <Text style={[styles.text, { color: tone.foreground }]}>{SUPPORT_STATUS_LABEL[status]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: theme.radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  text: { ...theme.text.micro },
});
