import type { CartQuote } from '@nilzora/contracts';
import { CircleAlert } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { cartLineName, cartLineProblemText } from '@/cart';
import { Card } from '@/components/card';
import { SectionHeader } from '@/components/section-header';
import { CartLineThumb } from '@/features/cart/cart-line-thumb';
import { formatMoney, itemCountLabel, spokenMoney } from '@/lib/money';
import { theme } from '@/theme';

/** What is being ordered, exactly as the API priced it for the chosen address. */
export function ItemsSection({ quote }: { quote: CartQuote }) {
  const units = quote.lines.reduce((total, line) => total + line.quantity, 0);
  return (
    <View style={styles.section}>
      <SectionHeader title={`Items (${itemCountLabel(units)})`} step={2} />
      <Card style={styles.card}>
        {quote.lines.map((line, index) => {
          const problem = cartLineProblemText(line);
          return (
            <View
              key={`${line.productId}:${line.variantId ?? ''}`}
              style={[styles.line, index > 0 ? styles.lineBorder : null]}
            >
              <CartLineThumb image={line.image} size={52} />
              <View style={styles.identity}>
                <Text style={styles.name}>{cartLineName(line)}</Text>
                {line.variantLabel ? <Text style={styles.detail}>{line.variantLabel}</Text> : null}
                <Text style={styles.detail}>
                  {`Qty ${line.quantity}`}
                  {line.unitPriceMinor !== null
                    ? ` · ${formatMoney(line.unitPriceMinor)} each`
                    : ''}
                </Text>
                {problem ? (
                  <View accessible accessibilityRole="alert" style={styles.problem}>
                    <CircleAlert size={16} color={theme.notice.danger.icon} accessible={false} />
                    <Text style={styles.problemText}>{problem}</Text>
                  </View>
                ) : null}
              </View>
              {problem === null && line.lineTotalMinor !== null ? (
                <Text
                  accessibilityLabel={`Line total: ${spokenMoney(line.lineTotalMinor)}`}
                  style={styles.total}
                >
                  {formatMoney(line.lineTotalMinor)}
                </Text>
              ) : null}
            </View>
          );
        })}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.spacing[2] },
  card: { paddingHorizontal: theme.spacing[4] },
  line: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[3],
  },
  lineBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
  identity: { flex: 1, gap: 2 },
  name: {
    color: theme.colors.foreground,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: theme.fontWeights.semibold,
  },
  detail: { color: theme.colors.mutedForeground, fontSize: 14 },
  problem: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  problemText: {
    flex: 1,
    color: theme.notice.danger.foreground,
    fontSize: 14,
    fontWeight: theme.fontWeights.semibold,
  },
  total: {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: theme.fontWeights.semibold,
    fontVariant: ['tabular-nums'],
  },
});
