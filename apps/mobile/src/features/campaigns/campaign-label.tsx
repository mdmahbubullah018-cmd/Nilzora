import type { CampaignSummary } from '@nilzora/contracts';
import { Sparkles } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';

/*
 * The promotional label a card or a detail screen shows beside a price, and the format
 * helpers behind it. A campaign never needs to be recalculated on the device: the API has
 * already priced the product, and this only says which campaign did it and when it ends.
 */

/** "20% off" / "৳300 off", with the cap only when the campaign has one. */
export function campaignOffer(
  campaign: Pick<CampaignSummary, 'discountKind' | 'discountValue' | 'maxDiscountMinor'>,
): string {
  const amount = formatOfferMoney(campaign.discountValue);
  if (campaign.discountKind === 'fixed') return `${amount} off`;
  const cap =
    campaign.maxDiscountMinor === null
      ? ''
      : ` (up to ${formatOfferMoney(campaign.maxDiscountMinor)})`;
  return `${String(campaign.discountValue)}% off${cap}`;
}

/** Poisha as taka, grouped in the Bangladeshi way. */
function formatOfferMoney(minor: number): string {
  const taka = minor / 100;
  const shown = Number.isInteger(taka)
    ? taka.toLocaleString('en-IN')
    : taka.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `৳${shown}`;
}

/** The end of a campaign as a short local date and time, or null. */
export function campaignEnds(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/**
 * What a campaign is called in customer copy. A campaign may be published without a customer
 * title — the admin leaves it empty and the offer speaks for it — so the offer stands in
 * rather than an empty line.
 */
export function campaignName(campaign: Pick<CampaignSummary, 'title'>, offer: string): string {
  const title = campaign.title.trim();
  return title === '' ? offer : title;
}

export interface CampaignLabelProps {
  campaign: { title: string; endsAt: string | null };
  /** Tighter padding for a product card. */
  compact?: boolean;
}

/**
 * The label itself. It is one accessible element: a screen reader reads the campaign and,
 * when there is one, when it ends.
 */
export function CampaignLabel({ campaign, compact = false }: CampaignLabelProps) {
  const ends = campaignEnds(campaign.endsAt);
  // A campaign published without a customer title still marks the price: the label stays
  // short and true instead of drawing an empty pill.
  const title = campaign.title.trim() === '' ? 'On sale' : campaign.title;
  // On a product card the pill has one short line to work with, so only the name is shown.
  const shownEnds = compact ? null : ends;
  const spoken =
    shownEnds === null ? `Promotion ${title}` : `Promotion ${title}, ends ${shownEnds}`;
  return (
    <View
      accessible
      accessibilityLabel={spoken}
      style={[styles.row, compact ? styles.rowCompact : null]}
    >
      <Sparkles size={11} color={theme.colors.violet} strokeWidth={2} />
      <Text numberOfLines={1} style={[styles.text, compact ? styles.textCompact : null]}>
        {title}
      </Text>
      {shownEnds === null ? null : (
        <Text numberOfLines={1} style={styles.ends}>
          · ends {shownEnds}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.radii.full,
    backgroundColor: 'rgba(139, 92, 246, 0.14)',
  },
  rowCompact: { paddingVertical: 1 },
  text: {
    color: theme.colors.violet,
    fontSize: 12,
    fontWeight: theme.fontWeights.semibold,
    flexShrink: 1,
  },
  textCompact: { fontSize: 11 },
  ends: { color: theme.colors.mutedForeground, fontSize: 11 },
});
