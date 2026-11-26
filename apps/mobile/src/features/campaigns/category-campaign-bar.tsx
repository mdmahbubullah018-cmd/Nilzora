import type { CampaignSummary } from '@nilzora/contracts';
import { Sparkles } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme';
import { campaignEnds, campaignName, campaignOffer } from './campaign-label';

/*
 * The slim promotion bar at the top of a category screen: the mobile counterpart of the
 * website's category promotion strip. It is drawn only for a campaign the API returns for this
 * category (live, visible and reaching at least one published product), so there is nothing to
 * hide and nothing invented: the title, the offer, the product count and the end time are all
 * the campaign's own. A campaign without a customer title is named by its offer, and the offer
 * is then not printed twice.
 */
export function CategoryCampaignBar({ campaign }: { campaign: CampaignSummary }) {
  const offer = campaignOffer(campaign);
  const name = campaignName(campaign, offer);
  const hasTitle = campaign.title.trim() !== '';
  const ends = campaignEnds(campaign.endsAt);
  const products = `${String(campaign.productCount)} ${campaign.productCount === 1 ? 'product' : 'products'}`;
  const facts = [products, ends === null ? null : `ends ${ends}`].filter(Boolean).join(' · ');
  const spoken = [`Promotion: ${name}`, hasTitle ? offer : null, facts].filter(Boolean).join(', ');

  return (
    <View testID="category-campaign-bar" accessible accessibilityLabel={spoken} style={styles.bar}>
      <View style={styles.glow} pointerEvents="none" />
      <View style={styles.icon}>
        <Sparkles size={16} color={theme.colors.sky} accessible={false} />
      </View>
      <View style={styles.text}>
        <Text numberOfLines={1} style={styles.name}>
          {name}
        </Text>
        <Text numberOfLines={1} style={styles.facts}>
          {facts}
        </Text>
      </View>
      {hasTitle ? (
        <View style={styles.badge}>
          <Text numberOfLines={1} style={styles.badgeText}>
            {offer}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    minHeight: 52,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.radii.lg,
    backgroundColor: theme.brand.navy,
    overflow: 'hidden',
  },
  // A soft violet wash across the right edge: the brand navy-to-violet, without a gradient lib.
  glow: {
    position: 'absolute',
    top: -30,
    right: -20,
    width: 140,
    height: 110,
    borderRadius: 70,
    backgroundColor: 'rgba(139, 92, 246, 0.35)',
  },
  icon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
  },
  text: { flex: 1, minWidth: 0, gap: 1 },
  name: { color: '#FFFFFF', fontSize: 14, lineHeight: 18, fontWeight: theme.fontWeights.semibold },
  facts: { color: theme.colors.border, fontSize: 11.5, lineHeight: 15 },
  badge: {
    maxWidth: 120,
    paddingVertical: 4,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.radii.full,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: theme.fontWeights.semibold,
  },
});
