import { MAX_LINE_QUANTITY, slugSchema, type CartLine } from '@nilzora/contracts';
import { Check, CircleAlert, Trash2 } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { cartLineName, cartLineProblemText } from '@/cart';
import { Card } from '@/components/card';
import { Price } from '@/components/price';
import { QuantityStepper } from '@/components/quantity-stepper';
import { formatMoney, spokenMoney } from '@/lib/money';
import { theme } from '@/theme';
import { CartLineThumb } from './cart-line-thumb';

export interface CartLineRowProps {
  /** The server's price for this line. */
  line: CartLine;
  /** What the cart holds now, which can be ahead of `line` while prices are refreshed. */
  quantity: number;
  /** Whether this line is going into the order; deselecting never removes it. */
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  onQuantityChange: (next: number) => void;
  onRemove: () => void;
  /** Opens the product page; omitted when there is none to open. */
  onOpenProduct?: (slug: string) => void;
}

/**
 * One cart line. Name, prices, problems and the line total are the API's; only the quantity
 * and the selection are the customer's own, shown at once. While the quote still describes an
 * older quantity (`quantity !== line.quantity`) the line total and any problem are held back
 * instead of being shown for the wrong number of units.
 */
export function CartLineRow({
  line,
  quantity,
  selected,
  onSelectedChange,
  onQuantityChange,
  onRemove,
  onOpenProduct,
}: CartLineRowProps) {
  const name = cartLineName(line);
  const updating = quantity !== line.quantity;
  const problem = updating ? null : cartLineProblemText(line);
  const available = line.availableQuantity;
  // A quantity can be chosen only while the product is on sale with stock to offer.
  const canChooseQuantity = available !== null && available > 0;
  const slug =
    line.problem !== 'unavailable' && slugSchema.safeParse(line.slug).success ? line.slug : null;
  const openProduct = onOpenProduct;

  return (
    <Card flat style={[styles.card, problem ? styles.cardProblem : null]}>
      <View style={styles.top}>
        <SelectBox
          checked={selected}
          name={name}
          onChange={onSelectedChange}
        />
        <CartLineThumb image={line.image} />
        <View style={styles.identity}>
          {slug !== null && openProduct ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={name}
              accessibilityHint="Opens the product"
              hitSlop={4}
              onPress={() => {
                openProduct(slug);
              }}
              style={styles.nameTarget}
            >
              <Text style={[styles.name, styles.nameLink]}>{name}</Text>
            </Pressable>
          ) : (
            <Text style={styles.name}>{name}</Text>
          )}
          {line.variantLabel ? <Text style={styles.variant}>{line.variantLabel}</Text> : null}
          {line.unitPriceMinor !== null ? (
            <Price
              priceMinor={line.unitPriceMinor}
              compareAtPriceMinor={line.compareAtPriceMinor}
              size="sm"
            />
          ) : null}
        </View>
        {/* Lines with a problem are left out of the total, so they show no line total. */}
        {updating ? (
          <Text style={styles.updating}>Updating…</Text>
        ) : problem === null && line.lineTotalMinor !== null ? (
          <Text
            accessibilityLabel={`Line total: ${spokenMoney(line.lineTotalMinor)}`}
            style={styles.lineTotal}
          >
            {formatMoney(line.lineTotalMinor)}
          </Text>
        ) : null}
      </View>

      {problem ? (
        <View accessible accessibilityRole="alert" style={styles.problem}>
          <CircleAlert size={16} color={theme.notice.danger.icon} accessible={false} />
          <Text style={styles.problemText}>
            {problem}
            <Text style={styles.problemNote}> · Not included in your total</Text>
          </Text>
        </View>
      ) : null}

      <View style={styles.bottom}>
        {canChooseQuantity ? (
          <QuantityStepper
            value={quantity}
            onChange={onQuantityChange}
            max={Math.min(available, MAX_LINE_QUANTITY)}
            productName={name}
            compact
          />
        ) : (
          <Text style={styles.fixedQuantity}>Quantity: {quantity}</Text>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name} from your cart`}
          hitSlop={4}
          onPress={onRemove}
          style={({ pressed }) => [styles.remove, pressed ? styles.removePressed : null]}
        >
          <Trash2 size={17} color={theme.colors.dangerAction} accessible={false} />
          <Text style={styles.removeText}>Remove</Text>
        </Pressable>
      </View>
    </Card>
  );
}

/**
 * The line's selection mark: a 20dp rounded box with a tick when it is on. The touch target is
 * the whole 44dp column, so it is easy to hit without taking room from the product.
 */
function SelectBox({
  checked,
  name,
  onChange,
}: {
  checked: boolean;
  name: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`Include ${name} in this order`}
      accessibilityState={{ checked }}
      hitSlop={8}
      onPress={() => onChange(!checked)}
      style={styles.selectTarget}
    >
      <View style={[styles.selectBox, checked ? styles.selectBoxChecked : null]}>
        {checked ? <Check size={14} color={theme.brand.onSolid} strokeWidth={3} accessible={false} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: theme.spacing[3], gap: theme.spacing[2] },
  cardProblem: { borderColor: theme.notice.danger.border, borderWidth: 1 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing[2] },
  /** The column the checkbox lives in: 20dp box, 44dp target, no extra row height. */
  selectTarget: {
    width: 28,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  selectBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: theme.colors.borderStrong,
    backgroundColor: theme.colors.surface,
  },
  selectBoxChecked: {
    borderColor: theme.brand.primary,
    backgroundColor: theme.brand.primary,
  },
  identity: { flex: 1, gap: theme.spacing[1] + 2 },
  name: {
    color: theme.colors.foreground,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: theme.fontWeights.semibold,
  },
  nameTarget: { minHeight: theme.touchTarget, justifyContent: 'center' },
  nameLink: { textDecorationLine: 'underline', textDecorationColor: theme.colors.borderStrong },
  variant: { color: theme.colors.mutedForeground, fontSize: 13, lineHeight: 18 },
  lineTotal: {
    color: theme.colors.foreground,
    fontSize: 16,
    fontWeight: theme.fontWeights.semibold,
    fontVariant: ['tabular-nums'],
  },
  updating: { color: theme.colors.mutedForeground, fontSize: 13 },
  problem: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.spacing[2] },
  problemText: {
    flex: 1,
    color: theme.notice.danger.foreground,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: theme.fontWeights.semibold,
  },
  problemNote: { fontWeight: theme.fontWeights.regular },
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[3],
  },
  fixedQuantity: { color: theme.colors.mutedForeground, fontSize: 14 },
  remove: {
    minHeight: theme.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.radii.md,
  },
  removePressed: { backgroundColor: theme.notice.danger.surface },
  removeText: {
    color: theme.colors.dangerAction,
    fontSize: 14,
    fontWeight: theme.fontWeights.semibold,
  },
});
