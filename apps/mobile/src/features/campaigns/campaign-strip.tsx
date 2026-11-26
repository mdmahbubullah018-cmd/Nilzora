import type { CampaignSummary } from '@nilzora/contracts';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { PhotoShade } from '@/components/photo-shade';
import { SectionHeader } from '@/components/section-header';
import { theme } from '@/theme';
import { GRID_GAP, SCREEN_PADDING } from '@/features/catalog/catalog-layout';
import { campaignEnds, campaignName, campaignOffer } from './campaign-label';

/*
 * The home screen's promotional band, drawn as banners rather than as cards.
 *
 * One campaign leads at the full width and the rest follow in a rail that shows a slice of the
 * next one, so the page never becomes a wall of artwork. Each banner is the campaign's own
 * picture (the 12:5 frame its upload guidance asks for) with a short block of words along the
 * bottom edge, over a navy fade: no shadow, no border and no panel behind the type, so the
 * artwork stays the subject. A campaign published without a picture gets the same banner in the
 * brand navy, in the same frame, so the section never changes shape.
 *
 * A campaign may be published without a customer title, so the offer stands in for the name and
 * the offer line is dropped rather than printed twice. Nothing is shown when no campaign is live.
 */

export interface CampaignStripProps {
  campaigns: readonly CampaignSummary[];
  onSelect: (campaign: CampaignSummary) => void;
}

/** Width of one banner in the rail: two whole banners and a slice of the third. */
function railBannerWidth(width: number): number {
  return Math.round((width - SCREEN_PADDING * 2 - GRID_GAP * 2) / 2.2);
}

function CampaignBanner({
  campaign,
  width,
  lead,
  onPress,
}: {
  campaign: CampaignSummary;
  width: number;
  /** The leading banner carries the tag and the call to action; the rail stays quiet. */
  lead: boolean;
  onPress: () => void;
}) {
  const offer = campaignOffer(campaign);
  const name = campaignName(campaign, offer);
  const ends = campaignEnds(campaign.endsAt);
  const hasTitle = campaign.title.trim() !== '';
  // The words under the name. The offer is never printed twice: a campaign without a title is
  // already named by it. The lead says when the sale ends; a banner in the rail says when it
  // ends, or how much is in it when it does not.
  const facts = lead
    ? [hasTitle ? offer : null, ends === null ? null : `ends ${ends}`]
    : [
        hasTitle ? offer : null,
        ends === null
          ? `${String(campaign.productCount)} ${campaign.productCount === 1 ? 'product' : 'products'}`
          : `Ends ${ends}`,
      ];
  const factLine = facts.filter(Boolean).join(' \u00B7 ');
  const spoken = [name, ...facts.filter(Boolean)].join(', ');
  const picture =
    campaign.banner === null ? null : lead ? campaign.banner.url : campaign.banner.thumbUrl;

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${spoken}. Shop the sale`}
      accessibilityHint="Opens the shop with this sale applied"
      onPress={onPress}
      android_ripple={{ color: 'rgba(255, 255, 255, 0.18)' }}
      style={({ pressed }) => [
        styles.banner,
        lead ? styles.lead : styles.railBanner,
        { width },
        pressed ? styles.pressed : null,
      ]}
    >
      {picture === null ? null : (
        <Image
          source={{ uri: picture }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessible={false}
        />
      )}
      <PhotoShade height={lead ? '62%' : '58%'} strength={lead ? 'strong' : 'soft'} />
      <View style={styles.body}>
        <Text numberOfLines={2} style={lead ? styles.leadName : styles.name}>
          {name}
        </Text>
        {factLine === '' ? null : (
          <Text numberOfLines={1} style={styles.fact}>
            {factLine}
          </Text>
        )}
        {lead ? <Text style={styles.cta}>{'Shop the sale \u2192'}</Text> : null}
      </View>
    </Pressable>
  );
}

export function CampaignStrip({ campaigns, onSelect }: CampaignStripProps) {
  const { width } = useWindowDimensions();
  if (campaigns.length === 0) return null;
  const [lead, ...rest] = campaigns;
  if (lead === undefined) return null;
  const railWidth = railBannerWidth(width);

  return (
    <View style={styles.section}>
      <SectionHeader title="On sale now" />
      <CampaignBanner
        campaign={lead}
        width={width - SCREEN_PADDING * 2}
        lead
        onPress={() => {
          onSelect(lead);
        }}
      />
      {rest.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={railWidth + GRID_GAP}
          snapToAlignment="start"
          style={styles.bleed}
          contentContainerStyle={styles.bleedContent}
          accessibilityLabel="More sales"
        >
          {rest.slice(0, 6).map((campaign) => (
            <CampaignBanner
              key={campaign.id}
              campaign={campaign}
              width={railWidth}
              lead={false}
              onPress={() => {
                onSelect(campaign);
              }}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.layout.sectionHeaderGap },

  /*
   * A banner, not a card: the picture fills the frame and the words sit on the fade along its
   * bottom edge. One radius, no border, no shadow - the artwork is the whole surface.
   */
  banner: {
    justifyContent: 'flex-end',
    borderRadius: theme.radii.hero,
    // The colour behind the fade, and the whole banner for a campaign with no picture.
    backgroundColor: theme.brand.navy,
    overflow: 'hidden',
  },
  /** The lead spans the page in the 12:5 frame the campaign uploader asks for. */
  lead: { aspectRatio: 12 / 5 },
  /** A banner in the rail: taller, so a two-line name and its facts still fit. */
  railBanner: { aspectRatio: 3 / 2 },
  pressed: { opacity: 0.94 },

  body: {
    gap: 2,
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[3],
  },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tagText: {
    color: theme.brand.sky,
    fontSize: 10,
    fontWeight: theme.fontWeights.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  leadName: {
    color: theme.brand.onSolid,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: theme.fontWeights.semibold,
    letterSpacing: -0.3,
  },
  name: {
    color: theme.brand.onSolid,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: theme.fontWeights.semibold,
  },
  fact: {
    color: 'rgba(255, 255, 255, 0.88)',
    fontSize: 12,
    lineHeight: 16,
  },
  cta: {
    marginTop: 4,
    color: theme.brand.onSolid,
    fontSize: 13,
    fontWeight: theme.fontWeights.semibold,
  },

  bleed: { marginHorizontal: -SCREEN_PADDING, flexGrow: 0 },
  bleedContent: { gap: GRID_GAP, paddingHorizontal: SCREEN_PADDING, paddingVertical: 2 },
});
