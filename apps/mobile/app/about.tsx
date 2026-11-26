import { INFO_PAGES } from '@nilzora/contracts';
import { StyleSheet, Text, View } from 'react-native';
import { Logo } from '@/components/logo';
import { InfoPageScreen } from '@/features/info/info-page-screen';
import { useStoreProfile } from '@/features/store/store-hooks';
import { theme } from '@/theme';

/**
 * About Nilzora. The wording is shared with the website; the only store-specific values are the
 * name and tagline the owner published, and nothing is assumed about history, team or numbers.
 */
export default function AboutScreen() {
  const profile = useStoreProfile().data?.profile;
  const tagline = profile?.tagline?.trim() ?? '';

  return (
    <InfoPageScreen
      page={INFO_PAGES.about}
      showUpdatedOn={false}
      hero={
        <View style={styles.hero}>
          <Logo size="lg" decorative />
          {tagline === '' ? null : <Text style={styles.tagline}>{tagline}</Text>}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: theme.spacing[3],
    padding: theme.spacing[5],
    borderRadius: theme.radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  tagline: {
    color: theme.colors.foreground,
    ...theme.text.subheading,
    fontSize: 17,
    lineHeight: 24,
  },
});
