import type { Category, MediaPicture } from '@nilzora/contracts';
import { useState } from 'react';
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { theme } from '@/theme';
import { CategoryIcon } from './product-visual';

/*
 * A category's cover picture
 * --------------------------
 * The admin uploads one picture per category; the API answers with the URLs of its two WebP
 * variants (full and thumb). This is the one place the app turns those URLs into pixels, so
 * the Home row, the Categories grid and the category screen all show the same picture in the
 * same frame — and all fall back to the category's icon when there is no cover or the file
 * cannot be loaded.
 *
 * The frame keeps its shape either way, so a category without a cover never collapses a row.
 */

export interface CategoryCoverProps {
  category: Pick<Category, 'slug'> & { image: MediaPicture | null };
  /** `thumb` (up to 480px) for rows and grids, `full` for a page header. */
  variant?: 'thumb' | 'full';
  /** The icon drawn when there is no cover to show. */
  iconSize?: number;
  style?: StyleProp<ViewStyle>;
  /** Test id of the picture itself (absent while the fallback icon is showing). */
  testID?: string;
}

export function CategoryCover({
  category,
  variant = 'thumb',
  iconSize = theme.icon.size.xl,
  style,
  testID,
}: CategoryCoverProps) {
  const image = category.image;
  const source = image === null ? null : variant === 'full' ? image.url : image.thumbUrl;
  // Remembered with the URL it belongs to, so a different cover starts over as "loading".
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const showPicture = source !== null && failedUri !== source;

  return (
    <View style={[styles.frame, style]}>
      {showPicture ? (
        <Image
          key={source}
          testID={testID}
          source={{ uri: source }}
          style={styles.picture}
          resizeMode="cover"
          accessible={false}
          onError={() => {
            setFailedUri(source);
          }}
        />
      ) : (
        <CategoryIcon
          categorySlug={category.slug}
          size={iconSize}
          strokeWidth={theme.icon.stroke.idle}
          color={theme.colors.primary}
          accessible={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceMuted,
    overflow: 'hidden',
  },
  picture: StyleSheet.absoluteFill,
});
