import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { EmptyState } from '@/components/empty-state';
import { icons } from '@/components/icon';
import { ScreenFrame } from '@/components/screen';
import { theme } from '@/theme';

/**
 * The customer app's own 404. Expo Router's built-in "Unmatched Route" screen paints itself
 * dark, which a light-only customer app cannot show, so every unmatched link lands here.
 */
export default function NotFoundRoute() {
  const router = useRouter();

  return (
    <ScreenFrame edges={['top', 'bottom']}>
      <View style={styles.container}>
        <EmptyState
          icon={icons.search}
          title="We couldn't find that page"
          description="The link you followed does not open a Nilzora screen any more."
          action={{ label: 'Back to home', onPress: () => router.replace('/') }}
        />
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceMuted,
  },
});
