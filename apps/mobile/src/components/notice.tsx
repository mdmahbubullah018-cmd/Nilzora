import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme, type NoticeTone } from '@/theme';

const icons: Record<NoticeTone, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
};

export interface NoticeProps {
  tone?: NoticeTone;
  title?: string;
  children?: ReactNode;
}

/** Inline feedback matching the web Alert. Errors are announced as alerts, others politely. */
export function Notice({ tone = 'info', title, children }: NoticeProps) {
  const colors = theme.notice[tone];
  const Icon = icons[tone];
  return (
    <View
      accessible
      accessibilityRole={tone === 'danger' ? 'alert' : 'text'}
      accessibilityLiveRegion="polite"
      style={[styles.notice, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Icon size={18} color={colors.icon} accessible={false} />
      <View style={styles.body}>
        {title ? <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text> : null}
        {children ? (
          <Text style={[styles.text, { color: colors.foreground }]}>{children}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    gap: theme.spacing[3],
    padding: theme.spacing[4],
    borderRadius: theme.radii.md,
    borderWidth: 1,
  },
  body: { flex: 1, gap: theme.spacing[1] },
  title: { fontSize: 14, fontWeight: theme.fontWeights.semibold },
  text: { fontSize: 14, lineHeight: 20 },
});
