import {
  INFO_LINK_LABELS,
  INFO_PAGES_UPDATED_ON,
  type InfoPage,
  type InfoSection,
} from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/card';
import { AppIcon } from '@/components/icon';
import { Screen, STACK_EDGES } from '@/components/screen';
import { formatDate } from '@/lib/dates';
import { theme } from '@/theme';
import { INFO_HREFS } from './routes';

/*
 * One information page — About, the Privacy policy or the Terms of service — laid out for a
 * phone: a display title, a lead line, then a single column of sections with plain paragraphs
 * and bullets. The wording comes from @nilzora/contracts, so the same text appears on the
 * website; only the layout is native.
 */

const RIPPLE = { color: 'rgba(2, 132, 199, 0.14)' } as const;

/** Body copy for an information page: long enough to read, short enough to stay comfortable. */
const BODY = {
  color: theme.colors.body,
  fontSize: 15,
  lineHeight: 23,
} as const;

function Paragraph({ children }: { children: string }) {
  return <Text style={styles.paragraph}>{children}</Text>;
}

/** One section: a heading, its paragraphs and, when it has them, its bullets. */
export function InfoSectionView({ section }: { section: InfoSection }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionHeading}>
        {section.heading}
      </Text>
      {section.paragraphs.map((paragraph, index) => (
        <Paragraph key={index}>{paragraph}</Paragraph>
      ))}
      {section.bullets === undefined ? null : (
        <View style={styles.bullets}>
          {section.bullets.map((bullet, index) => (
            <View key={index} style={styles.bulletRow}>
              <View style={styles.bulletDot} />
              <Text style={styles.bulletText}>{bullet}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export interface InfoPageScreenProps {
  page: InfoPage;
  /** The date changes only when the wording does; the About page has none. */
  showUpdatedOn?: boolean;
  /** The store's own published contact details, appended as the page's closing section. */
  contact?: InfoSection | undefined;
  /** A block above the title, used by the About page for the official artwork. */
  hero?: ReactNode;
}

export function InfoPageScreen({ page, showUpdatedOn = true, contact, hero }: InfoPageScreenProps) {
  const router = useRouter();
  const sections = contact === undefined ? page.sections : [...page.sections, contact];

  return (
    <Screen title={page.title} edges={STACK_EDGES}>
      {hero}
      <Text style={styles.summary}>{page.summary}</Text>
      {showUpdatedOn ? (
        <Text style={styles.updated}>Last updated {formatDate(INFO_PAGES_UPDATED_ON)}</Text>
      ) : null}

      <View style={styles.intro}>
        {page.intro.map((paragraph, index) => (
          <Paragraph key={index}>{paragraph}</Paragraph>
        ))}
        {page.notice === undefined ? null : <Text style={styles.notice}>{page.notice}</Text>}
      </View>

      <View style={styles.sections}>
        {sections.map((section) => (
          <InfoSectionView key={section.heading} section={section} />
        ))}
      </View>

      <Card>
        {page.related.map((key, index) => (
          <Pressable
            key={key}
            accessibilityRole="link"
            accessibilityLabel={INFO_LINK_LABELS[key]}
            onPress={() => {
              router.push(INFO_HREFS[key]);
            }}
            android_ripple={RIPPLE}
            style={({ pressed }) => [
              styles.linkRow,
              index === page.related.length - 1 ? null : styles.linkDivider,
              pressed ? styles.linkPressed : null,
            ]}
          >
            <Text style={styles.linkLabel}>{INFO_LINK_LABELS[key]}</Text>
            <AppIcon name="chevronRight" size="sm" color={theme.colors.mutedForeground} />
          </Pressable>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: {
    ...BODY,
    color: theme.colors.foreground,
    fontSize: 16,
    lineHeight: 24,
  },
  updated: { color: theme.colors.mutedForeground, ...theme.text.caption },
  intro: { gap: theme.spacing[3] },
  notice: {
    color: theme.colors.mutedForeground,
    fontSize: 14,
    lineHeight: 21,
    padding: theme.spacing[3],
    borderRadius: theme.radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  sections: { gap: theme.spacing[6] },
  section: { gap: theme.spacing[2] },
  sectionHeading: {
    color: theme.colors.foreground,
    ...theme.text.subheading,
    fontSize: 17,
    lineHeight: 24,
  },
  paragraph: BODY,
  bullets: { gap: theme.spacing[2], paddingTop: 2 },
  bulletRow: { flexDirection: 'row', gap: theme.spacing[3], paddingRight: theme.spacing[2] },
  bulletDot: {
    width: 6,
    height: 6,
    marginTop: 9,
    borderRadius: 3,
    backgroundColor: theme.colors.primaryAction,
  },
  bulletText: { ...BODY, flex: 1 },
  linkRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[5],
  },
  linkDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  linkPressed: { backgroundColor: theme.colors.surfaceMuted },
  linkLabel: { flex: 1, color: theme.colors.foreground, ...theme.text.bodyStrong },
});
