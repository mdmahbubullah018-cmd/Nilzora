import { useRouter, type Href } from 'expo-router';
import { StyleSheet, Text } from 'react-native';
import { theme } from '@/theme';

/**
 * The short agreement line under "Create account" and "Place order", with the policies it names
 * as links. A notice, not a pop-up: nothing blocks the action, and the full wording is one tap
 * away (the same text as the website).
 */
export function PolicyNotice({
  lead,
  links,
}: {
  /** The sentence up to the first link, e.g. "By placing this order you agree to the". */
  lead: string;
  /** Each policy to link, with the words that follow it. */
  links: readonly { label: string; href: Href; after: string }[];
}) {
  const router = useRouter();
  return (
    <Text style={styles.notice}>
      {lead}{' '}
      {links.map((link) => (
        <Text key={link.label}>
          <Text
            accessibilityRole="link"
            accessibilityHint={`Opens the ${link.label}`}
            onPress={() => router.push(link.href)}
            style={styles.link}
          >
            {link.label}
          </Text>
          {link.after}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  notice: { color: theme.colors.mutedForeground, ...theme.text.caption, textAlign: 'center' },
  link: { color: theme.colors.link, textDecorationLine: 'underline' },
});
