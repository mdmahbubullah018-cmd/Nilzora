import { Banknote, Info } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/card';
import { Screen, STACK_EDGES } from '@/components/screen';
import { theme } from '@/theme';

/*
 * Payment information.
 *
 * Nilzora is cash on delivery only, so this page says exactly that and nothing more. It
 * deliberately promises no saved cards, no wallet and no gateway: there is nothing here the
 * customer could manage, because there is nothing to manage.
 */
export default function PaymentScreen() {
  return (
    // The native header names the screen, so the page does not repeat its title.
    <Screen edges={STACK_EDGES}>
      <Card style={styles.card}>
        <View style={styles.header}>
          <View style={styles.icon}>
            <Banknote size={22} color={theme.colors.primary} accessible={false} />
          </View>
          <View style={styles.headerText}>
            <Text accessibilityRole="header" style={styles.title}>
              Cash on delivery
            </Text>
            <Text style={styles.subtitle}>The only payment method Nilzora takes today.</Text>
          </View>
        </View>
        <Text style={styles.body}>
          You pay in cash when your parcel arrives. The delivery agent collects the order total,
          including the delivery charge for your area, and you get a receipt.
        </Text>
        <Text style={styles.body}>
          The full amount is shown at checkout before you confirm the order, and it never changes
          after that.
        </Text>
      </Card>

      <Card style={styles.card}>
        <View style={styles.header}>
          <View style={styles.icon}>
            <Info size={22} color={theme.colors.primary} accessible={false} />
          </View>
          <View style={styles.headerText}>
            <Text accessibilityRole="header" style={styles.title}>
              No cards are stored
            </Text>
          </View>
        </View>
        <Text style={styles.body}>
          Nilzora does not ask for card or mobile-wallet details, and keeps none on your account. If
          online payment arrives, it will be announced here first.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: theme.spacing[5], gap: theme.spacing[3] },
  header: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[3] },
  icon: {
    width: 44,
    height: 44,
    borderRadius: theme.radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.iconSurface,
  },
  headerText: { flex: 1, gap: 2 },
  title: { color: theme.colors.foreground, ...theme.text.heading, fontSize: 17 },
  subtitle: { color: theme.colors.mutedForeground, ...theme.text.caption },
  body: { color: theme.colors.body, ...theme.text.body },
});
