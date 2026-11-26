import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ZoomableImage } from '@/components/zoomable-image';
import { theme } from '@/theme';

/*
 * The product photos, full screen, to pinch, pan and double-tap. It opens on the photo that was
 * tapped; the arrows (shown when there are several photos) move between them, and each photo
 * starts again at fit. Closing returns to the product screen exactly as it was. A Modal has its
 * own gesture root on Android, so one is provided here.
 */
export interface ZoomPhoto {
  url: string;
  alt: string;
}

export function PhotoZoomViewer({
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  photos: readonly ZoomPhoto[];
  /** The photo on show, or null while the viewer is closed. */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const open = index !== null && photos.length > 0;
  const current = open ? photos[Math.min(index, photos.length - 1)] : undefined;
  const count = photos.length;
  const at = open ? Math.min(index, count - 1) : 0;
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.backdrop}>
        <SafeAreaView edges={['top', 'bottom']} style={styles.frame}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityLiveRegion="polite" numberOfLines={1}>
              {count > 1 ? `Photo ${String(at + 1)} of ${String(count)}` : 'Photo'}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close the photo"
              onPress={onClose}
              hitSlop={10}
              style={({ pressed }) => [styles.round, pressed ? styles.pressed : null]}
            >
              <X size={20} color={theme.colors.softBackground} />
            </Pressable>
          </View>
          <View style={styles.stage}>
            {current ? (
              <ZoomableImage
                key={current.url}
                testID="product-photo-zoom"
                uri={current.url}
                accessibilityLabel={`${current.alt}. Pinch to zoom, double tap to zoom in or out.`}
              />
            ) : null}
            {count > 1 ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Previous photo"
                  onPress={() => {
                    onIndexChange((at - 1 + count) % count);
                  }}
                  style={({ pressed }) => [
                    styles.round,
                    styles.left,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <ChevronLeft size={22} color={theme.colors.softBackground} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Next photo"
                  onPress={() => {
                    onIndexChange((at + 1) % count);
                  }}
                  style={({ pressed }) => [
                    styles.round,
                    styles.right,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <ChevronRight size={22} color={theme.colors.softBackground} />
                </Pressable>
              </>
            ) : null}
          </View>
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(8, 15, 28, 0.96)' },
  frame: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  title: { flex: 1, color: theme.colors.softBackground, ...theme.text.caption },
  stage: { flex: 1, justifyContent: 'center' },
  round: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: theme.radii.full,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  pressed: { backgroundColor: 'rgba(255,255,255,0.26)' },
  left: { position: 'absolute', left: theme.spacing[2] },
  right: { position: 'absolute', right: theme.spacing[2] },
});
