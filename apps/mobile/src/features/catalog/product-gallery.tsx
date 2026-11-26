import type { ProductDetail, ProductVideo } from '@nilzora/contracts';
import { useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { theme } from '@/theme';
import { GalleryVideoPage } from './gallery-video';
import { PhotoZoomViewer } from './photo-zoom-viewer';
import { ProductVisual } from './product-visual';

/** Square, like the stored pictures, so nothing is letterboxed. */
const ASPECT_RATIO = 1;
const DOT = 8;
const ACTIONS = [
  { name: 'increment' },
  { name: 'decrement' },
  { name: 'zoom', label: 'Zoom photo' },
] as const;

/** One page of the gallery: a photo, or one of the product's videos (after the photos). */
type GalleryPhoto =
  | { kind: 'photo'; key: string; url: string; alt: string | null }
  | { kind: 'video'; key: string; video: ProductVideo; number: number };

export interface ProductGalleryProps {
  product: Pick<ProductDetail, 'name' | 'images' | 'videos'> & { category: { slug: string } };
  /** Fades the photos (a product that cannot be bought right now). */
  dimmed?: boolean;
  /**
   * The chosen variant's own photo. While it is set it is the gallery: the product's
   * pictures come back as soon as the variant has no photo of its own.
   */
  variantImageUrl?: string | null;
  /** The chosen option values, e.g. "Navy · M", for the spoken description. */
  variantLabel?: string | null;
}

/**
 * The photos at the top of the product screen. Without photos it is the placeholder tile;
 * with them it is a row of full-width pages that snap, with a dot for each. It is ONE
 * adjustable element for screen readers ("Cotton shirt photo, 2 of 3"), which swipe up or down
 * to change page, so the pages and dots are never read one by one. The first page is the first
 * thing the list renders; the others render as they come near.
 */
export function ProductGallery({
  product,
  dimmed = false,
  variantImageUrl = null,
  variantLabel = null,
}: ProductGalleryProps) {
  const window = useWindowDimensions();
  // The screen's padding is known, so the first frame is already the right size; the measured
  // width replaces it if the container turns out different (a split screen, say).
  const [measured, setMeasured] = useState<number | null>(null);
  const width = measured ?? window.width - theme.spacing[5] * 2;
  const list = useRef<FlatList<GalleryPhoto>>(null);
  // The photo open in the zoom viewer, as a position among the still photos (videos have none).
  const [zoomAt, setZoomAt] = useState<number | null>(null);

  const photos: GalleryPhoto[] =
    variantImageUrl !== null && variantImageUrl !== ''
      ? [{ kind: 'photo', key: variantImageUrl, url: variantImageUrl, alt: null }]
      : [
          ...product.images.map((image): GalleryPhoto => ({
            kind: 'photo',
            key: image.id,
            url: image.url,
            alt: image.alt,
          })),
          ...(product.videos ?? []).map((video, position): GalleryPhoto => ({
            kind: 'video',
            key: `video:${video.id}`,
            video,
            number: position + 1,
          })),
        ];
  // The set the page number belongs to: a new variant photo, or the product's own pictures
  // coming back, starts again at the first page instead of keeping a number from another set.
  const setKey = photos.map((photo) => photo.key).join('|');
  const [page, setPage] = useState({ setKey, index: 0 });
  const index = page.setKey === setKey ? page.index : 0;

  if (photos.length === 0) {
    return (
      <ProductVisual
        categorySlug={product.category.slug}
        size="hero"
        dimmed={dimmed}
        style={styles.page}
      />
    );
  }

  const last = photos.length - 1;
  const current = Math.min(index, last);
  const photo = photos[current];

  const goTo = (target: number) => {
    const next = Math.max(0, Math.min(last, target));
    setPage({ setKey, index: next });
    list.current?.scrollToOffset({ offset: next * width, animated: true });
  };

  const spoken = [product.name, variantLabel]
    .filter((part): part is string => typeof part === 'string' && part.trim() !== '')
    .join(', ');
  const label =
    photo?.kind === 'video'
      ? `${photo.video.title ?? spoken}, video`
      : photo?.alt && photo.alt.trim() !== ''
        ? photo.alt
        : `${spoken} photo`;
  // A video's own native controls must stay reachable, so the page in view is not folded
  // into one adjustable element while it is a video.
  const onVideo = photo?.kind === 'video';
  const stills = photos.flatMap((item) =>
    item.kind === 'photo' ? [{ url: item.url, alt: item.alt?.trim() || `${spoken} photo` }] : [],
  );

  return (
    <View
      accessible={!onVideo}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: `${current + 1} of ${photos.length}` }}
      accessibilityActions={ACTIONS}
      onAccessibilityAction={(event: AccessibilityActionEvent) => {
        if (event.nativeEvent.actionName === 'increment') goTo(current + 1);
        if (event.nativeEvent.actionName === 'decrement') goTo(current - 1);
        if (event.nativeEvent.actionName === 'zoom' && photo?.kind === 'photo') {
          setZoomAt(
            Math.max(
              0,
              stills.findIndex((still) => still.url === photo.url),
            ),
          );
        }
      }}
      onLayout={(event: LayoutChangeEvent) => {
        const next = Math.round(event.nativeEvent.layout.width);
        if (next > 0 && next !== measured) setMeasured(next);
      }}
      style={styles.gallery}
    >
      <FlatList
        ref={list}
        // Remounting on a new photo set is what puts the list back on its first page.
        key={setKey}
        testID="product-gallery-list"
        data={photos}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.key}
        initialNumToRender={1}
        windowSize={3}
        getItemLayout={(_data, itemIndex) => ({
          length: width,
          offset: width * itemIndex,
          index: itemIndex,
        })}
        onMomentumScrollEnd={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
          const pageNumber = Math.round(event.nativeEvent.contentOffset.x / width);
          setPage({ setKey, index: Math.max(0, Math.min(last, pageNumber)) });
        }}
        renderItem={({ item, index: itemIndex }) =>
          item.kind === 'video' ? (
            <GalleryVideoPage
              video={item.video}
              number={item.number}
              active={itemIndex === current}
              style={[styles.page, { width }]}
            />
          ) : (
            <Pressable
              accessible={false}
              onPress={() => {
                setZoomAt(
                  Math.max(
                    0,
                    stills.findIndex((still) => still.url === item.url),
                  ),
                );
              }}
            >
              <ProductVisual
                categorySlug={product.category.slug}
                size="hero"
                imageUri={item.url}
                imageFit="contain"
                dimmed={dimmed}
                style={[styles.page, { width }]}
              />
            </Pressable>
          )
        }
      />
      {photos.length > 1 ? (
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.dots}
        >
          {photos.map((item, dotIndex) => (
            <View
              key={item.key}
              testID={dotIndex === current ? 'gallery-dot-active' : 'gallery-dot'}
              style={[styles.dot, dotIndex === current ? styles.dotActive : null]}
            />
          ))}
        </View>
      ) : null}
      <PhotoZoomViewer
        photos={stills}
        index={zoomAt}
        onIndexChange={setZoomAt}
        onClose={() => {
          setZoomAt(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gallery: { width: '100%', aspectRatio: ASPECT_RATIO },
  page: { width: '100%', aspectRatio: ASPECT_RATIO },
  dots: {
    position: 'absolute',
    bottom: theme.spacing[2],
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  dotActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
});
