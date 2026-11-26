import { ApiError } from '@nilzora/api-client';
import { reviewSubmitRequestSchema } from '@nilzora/contracts';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { AppIcon } from '@/components/icon';
import { Notice } from '@/components/notice';
import { TextField } from '@/components/text-field';
import { useSession } from '@/auth/session-context';
import { describeApiError } from '@/lib/errors';
import { useAuthorizedApi } from '@/query';
import { theme } from '@/theme';
import { useRefreshMyReview, useSubmitReview } from './review-hooks';
import { ReviewPhotoList } from './review-photo-list';
import { useReviewPhotos, type QueuedPhoto } from './use-review-photos';

/*
 * Writing a review. The form is only shown to a customer the server said may review this
 * product, and the review is saved as waiting for the store to check it — so a saved review
 * never appears in the public list by itself. The rules below (1–5 stars, 10–2000 characters)
 * mirror the shared schema the API validates against; the API and the database have the last word.
 */

const MAX_TITLE = 120;
const MAX_BODY = 2000;
const RIPPLE = { color: 'rgba(2, 132, 199, 0.14)' } as const;

/** The API's fixed refusals, in the same words the storefront uses. */
function failureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'review_duplicate':
        return 'You have already reviewed this product.';
      case 'review_not_eligible':
      case 'forbidden':
        return 'Only customers who received this product can review it.';
      case 'review_account_blocked':
        return 'This account cannot post reviews.';
      case 'review_invalid':
      case 'bad_request':
      case 'validation_failed':
        return 'Check the rating and the text of your review.';
      default:
        break;
    }
  }
  return describeApiError(error).message;
}

export interface ReviewFormProps {
  productId: string;
}

/** Stars, an optional title and the review text. */
export function ReviewForm({ productId }: ReviewFormProps) {
  // The review is re-read only after its photos were tried: re-reading swaps this form for the
  // saved review, which would hide a photo that still needs another try.
  const submit = useSubmitReview(productId, { refresh: false });
  const refreshMine = useRefreshMyReview(productId);
  const { manager } = useSession();
  const run = useAuthorizedApi();
  const photoState = useReviewPhotos(manager);
  const [savedReviewId, setSavedReviewId] = useState<string | null>(null);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const send = () => {
    const parsed = reviewSubmitRequestSchema.safeParse({ rating, title, body });
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? '');
        found[field] ??= issue.message;
      }
      setErrors(found);
      return;
    }
    setErrors({});
    void post(parsed.data);
  };

  /** Saves the review once, then sends its photos. The review is never sent twice. */
  async function post(data: Parameters<typeof submit.mutateAsync>[0]) {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setPhotoNotice(null);
    try {
      let reviewId = savedReviewId;
      if (reviewId === null) {
        try {
          reviewId = (await submit.mutateAsync(data)).reviewId;
        } catch {
          return; // the form shows the refusal; the photos stay chosen for the next try
        }
        setSavedReviewId(reviewId);
      }
      if (photoState.photos.length === 0) {
        await refreshMine();
        return;
      }
      await finishPhotos(reviewId);
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  /** Sends the waiting photos, then shows the saved review unless some photo still needs a try. */
  async function finishPhotos(reviewId: string) {
    const round = await photoState.sendAll(reviewId);
    if (round.failed === 0) {
      await refreshMine();
      return;
    }
    setPhotoNotice(
      'Your review was saved. Some photos were not added: try them again or remove them, then tap Done.',
    );
  }

  async function retryPhotos() {
    if (busy.current || savedReviewId === null) return;
    busy.current = true;
    setWorking(true);
    try {
      await finishPhotos(savedReviewId);
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  async function deletePhoto(photo: QueuedPhoto) {
    if (busy.current || photo.imageId === undefined) return;
    const imageId = photo.imageId;
    busy.current = true;
    setWorking(true);
    try {
      await run((api, accessToken) => api.removeReviewImage(accessToken, imageId));
      photoState.forget(photo.key);
    } catch (error) {
      setPhotoNotice(describeApiError(error).message);
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  return (
    <View style={styles.form}>
      <View style={styles.field}>
        <Text style={styles.label}>Your rating</Text>
        <View accessibilityRole="radiogroup" style={styles.stars}>
          {[1, 2, 3, 4, 5].map((star) => {
            const chosen = star <= rating;
            return (
              <Pressable
                key={star}
                accessibilityRole="radio"
                accessibilityLabel={`${String(star)} ${star === 1 ? 'star' : 'stars'} out of 5`}
                accessibilityState={{ selected: rating === star }}
                onPress={() => {
                  setRating(star);
                  setErrors((current) => ({ ...current, rating: '' }));
                }}
                android_ripple={RIPPLE}
                style={styles.starButton}
              >
                <AppIcon
                  name="star"
                  size="md"
                  color={chosen ? theme.brand.warning : theme.colors.borderStrong}
                  filled={chosen}
                />
              </Pressable>
            );
          })}
        </View>
        {errors.rating ? <Text style={styles.error}>{errors.rating}</Text> : null}
      </View>

      <TextField
        label="Title"
        optional
        value={title}
        onChangeText={setTitle}
        maxLength={MAX_TITLE}
        error={errors.title}
        hint="Up to 120 characters."
      />

      <TextField
        label="Your review"
        value={body}
        onChangeText={setBody}
        multiline
        numberOfLines={5}
        maxLength={MAX_BODY}
        error={errors.body}
        hint="At least 10 characters, up to 2000."
      />

      <ReviewPhotoList
        photos={photoState.photos}
        upload={photoState.upload}
        problem={photoState.pickProblem}
        locked={working}
        saved={savedReviewId !== null}
        onAdd={() => void photoState.add()}
        onDiscard={photoState.discard}
        onRetry={() => void retryPhotos()}
        onDelete={(photo) => void deletePhoto(photo)}
      />

      {submit.error !== null && submit.isError && savedReviewId === null ? (
        <Notice tone="danger">{failureMessage(submit.error)}</Notice>
      ) : null}
      {photoNotice ? <Notice tone="warning">{photoNotice}</Notice> : null}

      {savedReviewId === null ? (
        <>
          <Button
            label="Post review"
            onPress={send}
            loading={working}
            accessibilityHint="Sends your review and photos to the store for checking"
          />
          <Text style={styles.note}>
            Your review appears on this page once the store has checked it.
          </Text>
        </>
      ) : (
        <Button
          label="Done"
          variant="secondary"
          disabled={working}
          onPress={() => void refreshMine()}
          accessibilityHint="Closes this form and shows your saved review"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: theme.spacing[4] },
  field: { gap: theme.spacing[2] },
  label: { color: theme.colors.foreground, fontSize: 13, fontWeight: theme.fontWeights.semibold },
  stars: { flexDirection: 'row', gap: theme.spacing[1] },
  starButton: {
    minWidth: theme.touchTarget,
    minHeight: theme.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.md,
  },
  error: { color: theme.colors.fieldError, fontSize: 12, lineHeight: 16 },
  note: { color: theme.colors.mutedForeground, fontSize: 12, lineHeight: 17 },
});
