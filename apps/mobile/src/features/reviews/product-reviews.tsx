import type { MyReview, PublicReview } from '@nilzora/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from '@/components/bottom-sheet';
import { Button } from '@/components/button';
import { AppIcon } from '@/components/icon';
import { Notice } from '@/components/notice';
import { ListSkeleton } from '@/components/skeleton';
import { useSignedInUserId } from '@/auth/session-context';
import { formatDate } from '@/lib/dates';
import { describeApiError } from '@/lib/errors';
import { authHref } from '@/lib/return-to';
import { theme } from '@/theme';
import { useMyReview, useProductReviews, useVoteReview } from './review-hooks';
import { ReviewForm } from './review-form';
import { RatingSummaryView, StarRow } from './rating-summary';

/** The muted ink the review list already uses for dates and captions. */
const MUTED_INK = '#475569';

/*
 * Reviews on the product screen: the rating summary, the published reviews and — for a
 * customer who received this product and has not reviewed it — the form. Everything here
 * came from the API. Only approved reviews are public and the average is counted from them,
 * so nothing on this screen can be raised by what the customer sends.
 *
 * The content is shown in the reviews sheet (product-reviews-sheet), which supplies the
 * heading; the product screen itself only keeps a compact trigger.
 */

const RIPPLE = { color: 'rgba(2, 132, 199, 0.14)' } as const;

/** The photos a customer attached, as thumbnails; tapping one opens it larger. */
function ReviewPhotos({
  images,
  author,
  onOpen,
}: {
  images: PublicReview['images'];
  /** Whose photos these are, for the spoken description. */
  author: string;
  onOpen: (index: number) => void;
}) {
  if (images.length === 0) return null;
  return (
    <View style={styles.photos}>
      {images.map((image, index) => (
        <Pressable
          key={image.id}
          accessibilityRole="imagebutton"
          accessibilityLabel={`Photo ${String(index + 1)} of ${String(images.length)} from ${author}, open it larger`}
          onPress={() => {
            onOpen(index);
          }}
          android_ripple={RIPPLE}
          style={styles.photoButton}
        >
          <Image
            source={{ uri: image.thumbUrl }}
            accessibilityIgnoresInvertColors
            resizeMode="cover"
            style={styles.photo}
          />
        </Pressable>
      ))}
    </View>
  );
}

function ReviewCard({
  review,
  first,
  onOpenPhoto,
  onVote,
  canVote,
  voting,
}: {
  review: PublicReview;
  first: boolean;
  onOpenPhoto: (images: PublicReview['images'], index: number) => void;
  onVote: (reviewId: string, verdict: 'helpful' | 'not_helpful' | null) => void;
  canVote: boolean;
  voting: boolean;
}) {
  // Pressing the verdict you already hold takes it back, which is the third action the row offers.
  const press = (verdict: 'helpful' | 'not_helpful') => {
    onVote(review.id, review.viewerVote === verdict ? null : verdict);
  };
  return (
    <View style={[styles.review, first ? styles.reviewFirst : null]}>
      <View style={styles.reviewTop}>
        <StarRow rating={review.rating} />
        <Text style={styles.reviewDate}>{formatDate(review.createdAt)}</Text>
      </View>
      {review.title ? <Text style={styles.reviewTitle}>{review.title}</Text> : null}
      <Text style={styles.reviewBody}>{review.body}</Text>
      <ReviewPhotos
        images={review.images}
        author={review.authorName}
        onOpen={(index) => {
          onOpenPhoto(review.images, index);
        }}
      />
      {review.reply === null ? null : (
        <View style={styles.businessReply}>
          <Text style={styles.businessReplyWho}>{review.reply.authorName} replied</Text>
          <Text style={styles.businessReplyBody}>{review.reply.body}</Text>
        </View>
      )}
      <View style={styles.reviewMeta}>
        <Text style={styles.reviewAuthor}>{review.authorName}</Text>
        {review.verified ? (
          <View style={styles.verified}>
            <AppIcon name="verified" size="sm" color={theme.colors.success} />
            <Text style={styles.verifiedText}>Verified purchase</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.votes}>
        <Text style={styles.votesLead}>Helpful?</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            selected: review.viewerVote === 'helpful',
            disabled: !canVote || voting,
          }}
          accessibilityLabel={
            review.viewerVote === 'helpful'
              ? `Remove your helpful vote, ${String(review.helpfulCount)} found this helpful`
              : `Mark this review helpful, ${String(review.helpfulCount)} found this helpful`
          }
          disabled={!canVote || voting}
          onPress={() => {
            press('helpful');
          }}
          hitSlop={6}
          style={({ pressed }) => [
            styles.voteButton,
            review.viewerVote === 'helpful' ? styles.voteButtonOn : null,
            pressed ? styles.voteButtonPressed : null,
            !canVote ? styles.voteButtonOff : null,
          ]}
        >
          <AppIcon
            name="like"
            size="sm"
            color={review.viewerVote === 'helpful' ? theme.colors.primaryAction : MUTED_INK}
          />
          <Text style={styles.voteCount}>{review.helpfulCount}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{
            selected: review.viewerVote === 'not_helpful',
            disabled: !canVote || voting,
          }}
          accessibilityLabel={
            review.viewerVote === 'not_helpful'
              ? 'Remove your not-helpful vote'
              : 'Mark this review not helpful'
          }
          disabled={!canVote || voting}
          onPress={() => {
            press('not_helpful');
          }}
          hitSlop={6}
          style={({ pressed }) => [
            styles.voteButton,
            review.viewerVote === 'not_helpful' ? styles.voteButtonOn : null,
            pressed ? styles.voteButtonPressed : null,
            !canVote ? styles.voteButtonOff : null,
          ]}
        >
          <AppIcon
            name="dislike"
            size="sm"
            color={review.viewerVote === 'not_helpful' ? theme.colors.primaryAction : MUTED_INK}
          />
          <Text style={styles.voteCount}>{review.notHelpfulCount}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** What the customer is told about the review they wrote, in moderation terms. */
function ownReviewStatus(review: NonNullable<MyReview['review']>): string {
  if (review.status === 'approved') return 'Published on this page.';
  if (review.status === 'rejected') {
    return review.moderationNote === null
      ? 'Not published.'
      : `Not published: ${review.moderationNote}`;
  }
  return review.moderationNote === null
    ? 'Waiting for the store to check it.'
    : `Waiting for the store to check it. ${review.moderationNote}`;
}

function OwnReviewCard({ review }: { review: NonNullable<MyReview['review']> }) {
  return (
    <View style={styles.ownReview}>
      <Text style={styles.cardTitle}>Your review</Text>
      <View style={styles.reviewTop}>
        <StarRow rating={review.rating} />
        <Text style={styles.reviewDate}>{formatDate(review.createdAt)}</Text>
      </View>
      {review.title ? <Text style={styles.reviewTitle}>{review.title}</Text> : null}
      <Text style={styles.reviewBody}>{review.body}</Text>
      <Text style={styles.ownReviewStatus}>{ownReviewStatus(review)}</Text>
    </View>
  );
}

export interface ProductReviewsProps {
  productId: string;
  slug: string;
}

export function ProductReviews({ productId, slug }: ProductReviewsProps) {
  const router = useRouter();
  const userId = useSignedInUserId();
  const feed = useProductReviews(slug);
  const mine = useMyReview(productId);
  const vote = useVoteReview(slug);
  /** The photo a customer tapped, shown larger over the screen. */
  const [viewer, setViewer] = useState<{ images: PublicReview['images']; index: number } | null>(
    null,
  );

  const summary = feed.summary;
  const published = feed.reviews;
  const canWrite = mine.data !== undefined && mine.data.review === null && mine.data.eligible;

  let list;
  if (feed.query.data === undefined) {
    list =
      feed.query.status === 'error' ? (
        <View style={styles.stateBlock}>
          <Notice tone="danger" title="Reviews could not be loaded">
            {describeApiError(feed.query.error).message}
          </Notice>
          <Button
            label="Try again"
            variant="secondary"
            onPress={() => void feed.query.refetch()}
            loading={feed.query.isRefetching}
          />
        </View>
      ) : (
        <ListSkeleton rows={2} label="Loading reviews" />
      );
  } else if (published.length === 0) {
    list = (
      <Text style={styles.muted}>
        No reviews yet. Buyers can review a product once they receive it.
      </Text>
    );
  } else {
    list = (
      <View style={styles.list}>
        {published.map((review, index) => (
          <ReviewCard
            key={review.id}
            review={review}
            first={index === 0}
            onOpenPhoto={(images, photoIndex) => {
              setViewer({ images, index: photoIndex });
            }}
            canVote={userId !== null}
            voting={vote.pending}
            onVote={(reviewId, verdict) => {
              vote.vote({ reviewId, verdict });
            }}
          />
        ))}
        {feed.query.hasNextPage ? (
          <Button
            label="Load more reviews"
            variant="secondary"
            onPress={() => void feed.query.fetchNextPage()}
            loading={feed.query.isFetchingNextPage}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.section}>
      {summary !== undefined && summary.reviewCount > 0 ? (
        <RatingSummaryView summary={summary} />
      ) : (
        <Text style={styles.muted}>
          Not rated yet. Only customers who received this product can rate it.
        </Text>
      )}

      {list}

      {canWrite ? (
        <View style={styles.writeCard}>
          <Text style={styles.cardTitle}>Write a review</Text>
          <Text style={styles.muted}>
            You bought this product, so you can review it. It appears here once the store has
            checked it.
          </Text>
          <ReviewForm productId={productId} />
        </View>
      ) : mine.data?.review != null ? (
        <OwnReviewCard review={mine.data.review} />
      ) : mine.data !== undefined && !mine.data.eligible ? (
        <Text style={styles.muted}>
          You can review this product once an order containing it has been delivered.
        </Text>
      ) : userId === null ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Sign in to review this product"
          onPress={() => {
            router.push(authHref('/sign-in', `/product/${slug}`));
          }}
          android_ripple={RIPPLE}
          style={styles.signInRow}
        >
          <Text style={styles.signInText}>Sign in to review a product you have received.</Text>
        </Pressable>
      ) : null}

      <BottomSheet
        visible={viewer !== null}
        onClose={() => {
          setViewer(null);
        }}
        title="Review photo"
      >
        {viewer === null ? null : (
          <View style={styles.viewer}>
            <Image
              source={{ uri: viewer.images[viewer.index]?.url ?? '' }}
              accessibilityIgnoresInvertColors
              accessibilityLabel={`Review photo ${String(viewer.index + 1)} of ${String(viewer.images.length)}`}
              resizeMode="contain"
              style={styles.viewerImage}
            />
            <Text style={styles.viewerCaption}>
              {`Photo ${String(viewer.index + 1)} of ${String(viewer.images.length)}`}
            </Text>
          </View>
        )}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: theme.spacing[5] },
  muted: { color: theme.colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  list: { gap: 0 },
  stateBlock: { gap: theme.spacing[3] },
  review: {
    paddingVertical: theme.spacing[4],
    gap: theme.spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  reviewFirst: { paddingTop: 0, borderTopWidth: 0 },
  reviewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  reviewDate: { color: theme.colors.mutedForeground, fontSize: 12, lineHeight: 16 },
  reviewTitle: {
    color: theme.colors.foreground,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: theme.fontWeights.semibold,
  },
  reviewBody: { color: theme.colors.body, fontSize: 14, lineHeight: 21 },
  /** The shop's own words, set apart from the customer's without competing with them. */
  businessReply: {
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.primary,
    backgroundColor: theme.colors.surfaceMuted,
    borderRadius: theme.radii.md,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    gap: 2,
  },
  businessReplyWho: {
    color: theme.colors.foreground,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: theme.fontWeights.semibold,
  },
  businessReplyBody: { color: theme.colors.body, fontSize: 13, lineHeight: 19 },
  votes: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing[2] },
  votesLead: { color: theme.colors.mutedForeground, fontSize: 12, lineHeight: 16 },
  voteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 32,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.radii.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  voteButtonOn: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.infoSurface,
  },
  voteButtonPressed: { opacity: 0.7 },
  voteButtonOff: { opacity: 0.5 },
  voteCount: { color: theme.colors.foreground, fontSize: 12, lineHeight: 16 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing[2] },
  photoButton: {
    width: 72,
    height: 72,
    borderRadius: theme.radii.md,
    overflow: 'hidden',
    backgroundColor: theme.colors.surfaceMuted,
  },
  photo: { width: '100%', height: '100%' },
  viewer: { gap: theme.spacing[3] },
  viewerImage: {
    width: '100%',
    height: 320,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.surfaceMuted,
  },
  viewerCaption: {
    color: theme.colors.mutedForeground,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  reviewMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing[2],
  },
  reviewAuthor: {
    color: theme.colors.foreground,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: theme.fontWeights.medium,
  },
  verified: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  verifiedText: { color: theme.colors.mutedForeground, fontSize: 12, lineHeight: 16 },
  writeCard: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
    borderRadius: theme.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceMuted,
  },
  cardTitle: {
    color: theme.colors.foreground,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: theme.fontWeights.semibold,
  },
  ownReview: {
    padding: theme.spacing[4],
    gap: theme.spacing[2],
    borderRadius: theme.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  ownReviewStatus: { color: theme.colors.mutedForeground, fontSize: 12, lineHeight: 17 },
  signInRow: {
    minHeight: theme.touchTarget,
    justifyContent: 'center',
    borderRadius: theme.radii.md,
  },
  signInText: { color: theme.colors.link, fontSize: 14, lineHeight: 20 },
});
