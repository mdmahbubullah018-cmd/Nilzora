import { MAX_REVIEW_IMAGES } from '@nilzora/contracts';
import { AlertCircle, Check, ImagePlus, X } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Button } from '@/components/button';
import { Notice } from '@/components/notice';
import { UploadProgress } from '@/components/upload-progress';
import type { NativeUpload } from '@/uploads/use-upload';
import { theme } from '@/theme';
import type { QueuedPhoto } from './use-review-photos';

const STATUS_TEXT: Record<QueuedPhoto['status'], string> = {
  queued: 'Waiting to be sent',
  uploading: 'Sending…',
  done: 'Added to your review',
  failed: 'Not added',
};

/** The caption on a tile: short, because the tile is small; the full wording is its accessible label. */
const STATUS_SHORT: Record<QueuedPhoto['status'], string> = {
  queued: 'Waiting',
  uploading: 'Sending…',
  done: 'Added',
  failed: 'Not added',
};

const GRID_COLUMNS = 4;
const GRID_GAP = theme.spacing[2];
/** The screen's side padding around the form; the grid shares what is left between its tiles. */
const SCREEN_PADDING = theme.spacing[5] * 2;
const MAX_TILE = 88;

export interface ReviewPhotoListProps {
  photos: QueuedPhoto[];
  upload: NativeUpload;
  problem: string | null;
  /** True while the review is being saved or its photos are being sent. */
  locked: boolean;
  /** The review is saved: photos can be sent again or deleted from it, not just dropped. */
  saved: boolean;
  onAdd: () => void;
  onDiscard: (key: string) => void;
  onRetry: () => void;
  onDelete: (photo: QueuedPhoto) => void;
}

/**
 * The photos picked for a review as one compact grid of equal, cropped squares: each with its own
 * remove control and short status, plus an add tile and an "n/4" counter. A photo of any size is
 * the same small tile, so the form never grows because of a picture.
 */
export function ReviewPhotoList({
  photos,
  upload,
  problem,
  locked,
  saved,
  onAdd,
  onDiscard,
  onRetry,
  onDelete,
}: ReviewPhotoListProps) {
  const { width } = useWindowDimensions();
  const tile = Math.min(
    MAX_TILE,
    Math.floor((width - SCREEN_PADDING - GRID_GAP * (GRID_COLUMNS - 1)) / GRID_COLUMNS),
  );
  const full = photos.length >= MAX_REVIEW_IMAGES;
  const hasFailed = photos.some((p) => p.status === 'failed' || p.status === 'queued');
  const failures = photos.filter((p) => p.status === 'failed' && p.message);
  return (
    <View style={styles.block}>
      <View style={styles.header}>
        <Text style={styles.label}>
          Photos <Text style={styles.optional}>(optional)</Text>
        </Text>
        <Text
          style={styles.count}
          accessibilityLabel={`${String(photos.length)} of ${String(MAX_REVIEW_IMAGES)} photos chosen`}
        >
          {photos.length}/{MAX_REVIEW_IMAGES}
        </Text>
      </View>
      <Text style={styles.hint}>
        Up to {String(MAX_REVIEW_IMAGES)} photos. JPEG, PNG or WebP, 5 MB each, at least 300 pixels
        on each side.
      </Text>

      <View style={styles.grid}>
        {photos.map((photo) => {
          const canDelete = photo.status === 'done' && saved;
          const canDiscard = photo.status !== 'uploading' && photo.status !== 'done';
          return (
            <View
              key={photo.key}
              accessible
              accessibilityLabel={`${photo.image.fileName}. ${STATUS_TEXT[photo.status]}`}
              style={[styles.tile, { width: tile, height: tile }]}
            >
              <Image
                source={{ uri: photo.image.uri }}
                accessibilityIgnoresInvertColors
                resizeMode="cover"
                style={styles.thumb}
              />
              <View style={[styles.caption, photo.status === 'failed' && styles.captionFailed]}>
                {photo.status === 'done' ? (
                  <Check size={11} color={theme.colors.surface} strokeWidth={3} />
                ) : photo.status === 'failed' ? (
                  <AlertCircle size={11} color={theme.colors.surface} strokeWidth={2.5} />
                ) : null}
                <Text numberOfLines={1} style={styles.captionText}>
                  {STATUS_SHORT[photo.status]}
                </Text>
              </View>
              {canDelete || canDiscard ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${canDelete ? 'Delete' : 'Remove'} ${photo.image.fileName}`}
                  disabled={locked}
                  hitSlop={10}
                  onPress={() => (canDelete ? onDelete(photo) : onDiscard(photo.key))}
                  style={[styles.remove, locked && styles.dimmed]}
                >
                  <X size={14} color={theme.colors.surface} strokeWidth={2.5} />
                </Pressable>
              ) : null}
            </View>
          );
        })}
        {!saved || !full ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={photos.length === 0 ? 'Add photos' : 'Add more photos'}
            accessibilityHint="Opens your photos"
            accessibilityState={{ disabled: locked || full }}
            disabled={locked || full}
            onPress={onAdd}
            style={({ pressed }) => [
              styles.add,
              { width: tile, height: tile },
              (locked || full) && styles.dimmed,
              pressed && styles.addPressed,
            ]}
          >
            <ImagePlus size={24} color={theme.colors.primary} strokeWidth={1.75} />
          </Pressable>
        ) : null}
      </View>

      {failures.map((photo) => (
        <Text key={photo.key} style={styles.failure}>
          {photo.image.fileName}: {photo.message}
        </Text>
      ))}

      {/* Each tile shows its own outcome, so only a transfer in flight is shown here. */}
      {upload.busy ? <UploadProgress state={upload.state} onCancel={upload.cancel} /> : null}

      {problem ? <Notice tone="warning">{problem}</Notice> : null}

      {saved && hasFailed && !locked ? (
        <Button label="Try the remaining photos again" variant="secondary" onPress={onRetry} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: theme.spacing[2] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { color: theme.colors.foreground, fontSize: 13, fontWeight: theme.fontWeights.semibold },
  optional: { color: theme.colors.mutedForeground, fontWeight: theme.fontWeights.regular },
  count: { color: theme.colors.mutedForeground, ...theme.text.caption },
  hint: { color: theme.colors.mutedForeground, ...theme.text.caption },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  tile: {
    borderRadius: theme.radii.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface,
  },
  thumb: { width: '100%', height: '100%' },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 2,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
  },
  captionFailed: { backgroundColor: 'rgba(185, 28, 28, 0.85)' },
  captionText: {
    color: theme.colors.surface,
    fontSize: 10,
    fontWeight: theme.fontWeights.semibold,
  },
  remove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
  },
  dimmed: { opacity: 0.5 },
  add: {
    borderRadius: theme.radii.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPressed: { backgroundColor: theme.colors.border },
  failure: { color: theme.colors.fieldError, ...theme.text.caption },
});
