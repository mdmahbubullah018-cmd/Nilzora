import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';
import { Logo } from './logo';
import { Screen, STACK_EDGES } from './screen';
import { SoftWash } from './soft-wash';

export interface AuthScaffoldProps {
  /** The screen's heading: what the customer is doing here. */
  title: string;
  /** One or two lines of supporting text. */
  subtitle: string;
  children: ReactNode;
  /** A quiet line under the form (a link to the other way in, for example). */
  footer?: ReactNode;
  /** A small label above the heading, e.g. "Step 2 of 2". */
  eyebrow?: string;
}

/**
 * The frame shared by every authentication screen.
 *
 * It opens with the brand on a pale blue wash — the official lockup, a short label, the heading
 * and one line of supporting copy — then the form itself on the app's white page. The wash is
 * the light counterpart of the navy panel this screen used to open with: it keeps the sign-in
 * experience bright and premium, and leaves the navy to the words, where it reads best. The
 * gradient behind the text is decorative: it cannot take a touch and is hidden from screen
 * readers.
 *
 * Everything below is the form itself, using the existing <Screen>, so safe areas, scrolling
 * and keyboard avoidance are already handled, and the header stays compact enough for the first
 * field to be visible on a small phone without scrolling.
 */
export function AuthScaffold({ title, subtitle, children, footer, eyebrow }: AuthScaffoldProps) {
  return (
    <Screen
      edges={STACK_EDGES}
      header={
        <View style={styles.hero}>
          <SoftWash />
          <View style={styles.brandRow}>
            <Logo size="md" surface="light" />
          </View>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      }
    >
      {children}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: theme.spacing[2],
    padding: theme.spacing[6],
    borderRadius: theme.radii.hero,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.accentBorder,
    backgroundColor: theme.colors.accentSurface,
    overflow: 'hidden',
    ...theme.shadow.card,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: theme.spacing[3] },
  eyebrow: {
    color: theme.colors.link,
    ...theme.text.micro,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  title: {
    color: theme.colors.foreground,
    fontSize: 27,
    lineHeight: 33,
    fontWeight: theme.fontWeights.semibold,
    letterSpacing: -0.6,
  },
  subtitle: { color: theme.colors.body, ...theme.text.lead },
  footer: { gap: theme.spacing[2], paddingTop: theme.spacing[1] },
});
